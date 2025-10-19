#!/usr/bin/env node

import { Command } from 'commander';
import dgram from 'dgram';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { gateway4sync } from 'default-gateway';
import ping from 'ping';
import crypto from 'crypto';
import dns from 'dns';

const program = new Command();
const discover_port = 6767;
const transfer_port = 6969;

function getChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (error) => reject(error));
    });
}

function removespacesFileName(fileName) {
    return fileName.replace(/\s+/g, '_');
}

function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'unknown';
}

async function resolveHost(input) {
    if (input.includes('.')) {
        return input;
    }

    if (/^\d+$/.test(input)) {
        try {
            const { gateway } = await gateway4sync();
            if (gateway) {
                const subnet = gateway.split('.').slice(0, 3).join('.');
                return `${subnet}.${input}`;
            }
        } catch (error) {
            console.error(`couldn't get your router's subnet:`, error.message);
        }
    }

    return new Promise((resolve, reject) => {
        dns.lookup(input, (err, address) => {
            if (err) {
                reject(new Error(`unable to resolve "${input}": ${err.message}`));
            } else {
                resolve(address);
            }
        });
    });
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

async function subnetPing() {
    try {
        const { gateway: routerIP } = await gateway4sync();
        if (!routerIP) {
            console.warn(`couldn't get your router's IP address. are you on LAN?`);
            return null;
        }

        const result = await ping.promise.probe(routerIP);
        if (result.alive) {
            console.log(`router: ${routerIP} - ping: ${result.time}ms`);
            console.log(``);
        } else {
            console.warn(`your router ${routerIP} is unreachable.`);
        }

        return result;

    } catch (error) {
        console.error(`your router's IP has been found, but pinging it failed. error: `, error.message);
        return null;
    }
}

function startTCPServer(customPath) {
    const tcpServer = net.createServer((socket) => {
        console.log(``);
        console.log(`connected to: ${socket.remoteAddress}:${socket.remotePort}`);

        let fileStream = null;
        let fileName = '';
        let fileSize = 0;
        let bytesReceived = 0;
        let startTime = 0;
        let lastUpdateTime = 0;
        let lastBytesCount = 0;
        let filePath = '';
        let expectedChecksum = '';

        socket.on('data', async (chunk) => {
            if (!fileStream) {
                try {
                const headerEnd = chunk.toString('utf-8', 0, Math.min(512, chunk.length)).indexOf('\n');
                if (headerEnd !== -1) {
                    const headerStr = chunk.toString('utf-8', 0, headerEnd);
                 const metadata = JSON.parse(headerStr);
                
                    fileName = metadata.fileName;
                    fileSize = metadata.fileSize;
                    expectedChecksum = metadata.checksum;
                    startTime = Date.now();
                    lastUpdateTime = startTime;
                
                    const downloadDir = customPath
                       ? path.resolve(customPath)
                       : process.cwd();

                    if (!fs.existsSync(downloadDir)) {
                       fs.mkdirSync(downloadDir, { recursive: true });
                    }
                    filePath = path.join(downloadDir, fileName);
                    fileStream = fs.createWriteStream(filePath);
                    console.log(`recieving: "${fileName}" (${formatBytes(fileSize)});`);
                
                    const fileDataStart = headerEnd + 1;
                    if (fileDataStart < chunk.length) {
                        const fileData = chunk.slice(fileDataStart);
                       fileStream.write(fileData);
                        bytesReceived += fileData.length;
                    }
                }
            } catch (error) {
                console.error(`error parsing file's metadata:`, error.message);
                socket.destroy();
            }
        } else {
            const eofBuffer = Buffer.from('__EOF__');
            const eofIndex = chunk.indexOf(eofBuffer);
            if (eofIndex !== -1) {
                if (eofIndex > 0) {
                    const dataBeforeEOF = chunk.slice(0, eofIndex);
                    fileStream.write(dataBeforeEOF);
                    bytesReceived += dataBeforeEOF.length;
                };

                fileStream.end();
                fileStream.on('finish', async () => {
                    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    console.log(``);
                    console.log(`\nrecieved "${fileName}" in ${totalTime} seconds!`);
                    console.log(`file saved to "${filePath}"`);
                    
                    console.log(`comparing checksums with the original file...`);
                    try {
                        const recievedChecksum = await getChecksum(filePath);
                        if (recievedChecksum === expectedChecksum) {
                            console.log(`both checksums are valid!`);
                            socket.write('checksum_valid');
                        } else {
                            console.log(`checksums don't match. the file is probably corrupted.`);
                            console.log(`do you want to (d)elete it, (k)eep it, or (r)etry the transfer?`);
                            socket.write('checksum_invalid');

                            let alreadyInputed = false;
                            process.stdin.setRawMode(true);
                            process.stdin.resume();

                            process.stdin.on('data', (key) => {
                                if (alreadyInputed) return;
                                alreadyInputed = true;
                                const char = key.toString().toUpperCase();

                                if (char === 'D') {
                                    fs.unlinkSync(filePath);
                                    console.log(`the file has been deleted. operation aborted.`);
                                    socket.write('checksum_post_delete');
                                    process.stdin.setRawMode(false);
                                    process.stdin.pause();
                                    socket.destroy();

                                } else if (char === 'R') {
                                    console.log(`deleting the corrupted file and retrying the transfer...`);
                                    socket.write('checksum_post_retry');
                                    process.stdin.setRawMode(false);
                                    process.stdin.pause();
                                    fs.unlinkSync(filePath);
                                    fileStream = null;
                                    bytesReceived = 0;

                                } else if (char === 'K') {
                                    console.log(`the file has been saved anyway.`);
                                    socket.write('checksum_post_keepanyway');
                                    process.stdin.setRawMode(false);
                                    process.stdin.pause();
                                    socket.destroy();
                                }
                            });
                        }
                    } catch (error) {
                        console.error(`error calculating the checksum:`, error.message);
                        socket.write('checksum_calc_error');
                    }
                });
            } else {
                fileStream.write(chunk);
                bytesReceived += chunk.length;
            
                const currentTime = Date.now();
                const elapsedSeconds = (currentTime - startTime) / 1000;
                const timeSinceLastUpdate = (currentTime - lastUpdateTime) / 1000;

                if (timeSinceLastUpdate >= 0.1) {
                    const progress = ((bytesReceived / fileSize) * 100).toFixed(1);
                    const avgSpeed = bytesReceived / elapsedSeconds;
                    const currentSpeed = (bytesReceived - lastBytesCount) / timeSinceLastUpdate;
                    const displaySpeed = (avgSpeed * 0.7 + currentSpeed * 0.3);
                    const timeRemaining = (fileSize - bytesReceived) / displaySpeed;
                    const minutes = Math.floor(timeRemaining / 60);
                    const seconds = Math.floor(timeRemaining % 60);

                    process.stdout.write(
                        `\r${progress}% - ${formatBytes(bytesReceived)} / ${formatBytes(fileSize)} (${formatBytes(displaySpeed)}/s, ${minutes}m ${seconds}s left)`
                    );

                    lastUpdateTime = currentTime;
                    lastBytesCount = bytesReceived;
                }
            }
        }
        });
        });
        tcpServer.listen(transfer_port, '0.0.0.0', () => {
            console.log(`now active on port ${transfer_port} for file transfers.`);
            console.log(`\ntip! as long as the host is running, you can keep sending files to it! you don't need to restart the command after each transfer!!`)
        });
        return tcpServer;
    };

async function sendFile(hostIP, filePath, rename) {
    return new Promise(async (resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`file not found: ${filePath}`));
        }

        console.log(`calculating checksum of original file...`);
        let checksum;
        try {
            checksum = await getChecksum(filePath);
        } catch (error) {
            return reject(new Error(`error calculating the checksum: ${error.message}`));
        }

        let fileName = path.basename(filePath);
        if (rename) {
            const extension = path.extname(fileName);
            fileName = removespacesFileName(rename) + extension;
        } else {
            fileName = removespacesFileName(fileName);
        }

        const fileSize = fs.statSync(filePath).size;
        const socket = net.createConnection({ host: hostIP, port: transfer_port }, () => {
            const metadata = { fileName, fileSize, checksum };
            const metadataStr = JSON.stringify(metadata) + '\n';
            socket.write(metadataStr);

            const fileStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
            let bytesSent = 0;
            const startTime = Date.now();
            let lastUpdateTime = startTime;
            let lastBytesCount = 0;

            console.log(`sending: "${fileName}" (${formatBytes(fileSize)});`);

            fileStream.on('data', (chunk) => {
                socket.write(chunk);
                bytesSent += chunk.length;
                
                const currentTime = Date.now();
                const elapsedSeconds = (currentTime - startTime) / 1000;
                const timeSinceLastUpdate = (currentTime - lastUpdateTime) / 1000;
                
                if (timeSinceLastUpdate >= 0.1) {
                    const progress = ((bytesSent / fileSize) * 100).toFixed(1);
                    const avgSpeed = bytesSent / elapsedSeconds;
                    const currentSpeed = (bytesSent - lastBytesCount) / timeSinceLastUpdate;
                    const displaySpeed = (avgSpeed * 0.7 + currentSpeed * 0.3);
                    const timeRemaining = (fileSize - bytesSent) / displaySpeed;
                    const minutes = Math.floor(timeRemaining / 60);
                    const seconds = Math.floor(timeRemaining % 60);
                    
                    process.stdout.write(
                        `\r${progress}% - ${formatBytes(bytesSent)} / ${formatBytes(fileSize)} (${formatBytes(displaySpeed)}/s, ${minutes}m ${seconds}s left)`
                    );
                    lastUpdateTime = currentTime;
                    lastBytesCount = bytesSent;
                }
            });
            fileStream.on('end', () => {
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                const avgSpeed = formatBytes(bytesSent / (Date.now() - startTime) * 1000);

                console.log(``);
                console.log(`\r\nsent "${fileName}" successfully! (in ${totalTime} seconds at ${avgSpeed}/s)`);
                console.log(`waiting for the host to verify checksum...`);
                socket.write('__EOF__')
            });
            fileStream.on('error', (error) => {
                console.error(`\nerror while reading your file (corruption?):`, error.message);
                socket.destroy();
                reject(error);
            });
        })
        socket.on('data', (response) => {
            const result = response.toString().trim()

            if (result === 'checksum_valid') {
                console.log(`the host validated the checksum!`);
                socket.destroy();
                resolve();

            } else if (result === 'checksum_invalid') {
                console.log(`the checksums don't match, the file may be corrupted.`);
                console.log(`waiting for the host to decide what to do...`);

            } else if (result === 'checksum_post_retry') {
                console.log(`host requested retry, resending file...\n`);

                const metadata = { fileName, fileSize, checksum };
                const metadataStr = JSON.stringify(metadata) + '\n';
                socket.write(metadataStr);

                const fileStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
                let bytesSent = 0;
                const startTime = Date.now();
                let lastUpdateTime = startTime;
                let lastBytesCount = 0;

                console.log(`sending: "${fileName}" (${formatBytes(fileSize)});`);
                fileStream.on('data', (chunk) => {
                    socket.write(chunk);
                    bytesSent += chunk.length;

                    const currentTime = Date.now();
                    const elapsedSeconds = (currentTime - startTime) / 1000;
                    const timeSinceLastUpdate = (currentTime - lastUpdateTime) / 1000;

                    if (timeSinceLastUpdate >= 0.1) {
                        const progress = ((bytesSent / fileSize) * 100).toFixed(1);
                        const avgSpeed = bytesSent / elapsedSeconds;
                        const currentSpeed = (bytesSent - lastBytesCount) / timeSinceLastUpdate;
                        const displaySpeed = (avgSpeed * 0.7 + currentSpeed * 0.3);
                        const timeRemaining = (fileSize - bytesSent) / displaySpeed;
                        const minutes = Math.floor(timeRemaining / 60);
                        const seconds = Math.floor(timeRemaining % 60);

                        process.stdout.write(
                            `\r${progress}% - ${formatBytes(bytesSent)} / ${formatBytes(fileSize)} (${formatBytes(displaySpeed)}/s, ${minutes}m ${seconds}s left)`
                        );
                        lastUpdateTime = currentTime;
                        lastBytesCount = bytesSent;
                    }
                });

                fileStream.on('end', () => {
                    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    const avgSpeed = formatBytes(bytesSent / (Date.now() - startTime) * 1000);
                    console.log(``);
                    console.log(`\r\nsent "${fileName}" successfully! (in ${totalTime} seconds at ${avgSpeed}/s)`);
                    console.log(`waiting for the host to verify checksum...`);
                    socket.write('__EOF__');
                });

                fileStream.on('error', (error) => {
                    console.error(`\nerror while reading your file:`, error.message);
                    socket.destroy();
                    reject(error);
                });

            } else if (result === 'checksum_post_keepanyway') {
                console.log(`host kept the file anyway.`);
                socket.destroy();
                resolve();

            } else if (result === 'checksum_post_delete') {
                console.log(`host deleted the file.`);
                socket.destroy();
                resolve();
            }
        });
        socket.on('error', (error) => {
            console.error(`\nerror occured with the connection to the other device:`, error.message);
            reject(error);
        });
    });
}

program
    .command('host')
    .description('start a share server to allow recieving files on the device,')
    .alias('start')
    .option('--path <directory>', 'directory where to save the recieved files to')
    .action(async (options) => {
        await subnetPing();
        startTCPServer(options.path);
        const udpServer = dgram.createSocket('udp4');
        
        udpServer.on('message', (msg, rinfo) => {
            const message = msg.toString().trim();
            if (message === 'TRANSFER_DISCOVER') {
                const info = {
                    hostname: os.hostname(),
                    ip: getLocalIP(),
                    os: (() => {
                        const platform = os.platform();
                        if (platform === 'win32') return 'Windows';
                        if (platform === 'darwin') return 'macOS';
                        if (platform === 'linux') return 'Linux';
                        return platform;
                    })(),
                };
                const reply = Buffer.from(JSON.stringify(info));
                udpServer.send(reply, rinfo.port, rinfo.address);
                console.log(`discovery request from ${rinfo.address}`);
            }
        });
        udpServer.bind(discover_port, () => {
            udpServer.setBroadcast(true);
            console.log(`now active on port ${discover_port} for host discovery,`);
        });
    });

program
    .command('discover')
    .description('lists the devices currently hosting a share session on your LAN,')
    .alias('find')
    .action(async () => {
        const socket = dgram.createSocket('udp4');
        const message = Buffer.from('TRANSFER_DISCOVER');
        const hosts = [];

        socket.on('message', (msg) => {
            try {
                const info = JSON.parse(msg.toString());
                hosts.push(info);
            } catch {}
        });

        socket.bind(() => {
            socket.setBroadcast(true);
            socket.send(message, 0, message.length, discover_port, '255.255.255.255', () => {
                setTimeout(() => {
                    if (hosts.length === 0) {
                        console.log(`not a single device hosting a share session was found on your LAN!`);
                    } else {
                        console.log(`available hosts:`);
                        console.log(``);
                        hosts.forEach(host => {
                            console.log(`* ${host.hostname} on ${host.os} (${host.ip})`);
                        });
                    }
                    socket.close();
                }, 1500);
            });
        });
    });

program
    .command('send <IP/ID/hostname> <filePath>')
    .description(`send a file to a host on your LAN. you may use the IP, hostname, or the last byte of the IP (e.g '31' for '192.168.1.31'),`)
    .option('--rename <newName>', 'override the original file name for the recieving host')
    .action(async (hostIP, filePath, options) => {
        try {
            const resolvedIP = await resolveHost(hostIP);
            console.log(`\nconnecting to resolved host ${resolvedIP}...`);
            await sendFile(resolvedIP, filePath, options.rename);
        } catch (error) {
            console.error(`an error occured while sending:`, error.message);
        }
    });

program
    .command('speed info')
    .description('small fyi about ethernet technical stuff and their associated speeds,')
    .action(async () => {
        console.log("\nfyi regarding ethernet technical terms stuff and their speeds (cuz its confusing sometimes)");
        console.log("slowest to fastest:");
        console.log("\n* Fast Ethernet (100 Mbps) - this is a lie lol its slow as hell");
        console.log("* Gigabit Ethernet (1 Gbps) - now this is actually good");
        console.log("\nafter that, names aren't confusing anymore: 2.5 Gbps > 5 Gbps > 10 Gbps");
        console.log("and after that theres more but these are more enterprise related");
    });

program.parse();