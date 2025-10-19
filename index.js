#!/usr/bin/env node

import { Command } from 'commander';
import dgram from 'dgram';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { gateway4sync } from 'default-gateway';
import ping from 'ping';

const program = new Command();
const discover_port = 6767;
const transfer_port = 6969;

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

        socket.on('data', (chunk) => {
            if (!fileStream) {
                try {
                    const headerEnd = chunk.toString('utf-8', 0, Math.min(512, chunk.length)).indexOf('\n');
                    if (headerEnd !== -1) {
                        const headerStr = chunk.toString('utf-8', 0, headerEnd);
                        const metadata = JSON.parse(headerStr);
                        fileName = metadata.fileName;
                        fileSize = metadata.fileSize;
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
        });

        socket.on('end', () => {
            if (fileStream) {
                fileStream.end();
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                console.log(``);
                console.log(`\nrecieved "${fileName}" in ${totalTime} seconds!`);
                console.log(`file saved to "${filePath}"`);
            }
            socket.destroy();
        });
        socket.on('error', (error) => {
            console.log(``);
            console.error(`error while recieving the file:`, error.message);
            if (fileStream) fileStream.destroy();
        });
    });
    tcpServer.listen(transfer_port, '0.0.0.0', () => {
        console.log(`now active on port ${transfer_port} for file transfers.`);
    });
    return tcpServer;
}

async function sendFile(hostIP, filePath, rename) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`file not found: ${filePath}`));
        }

        let fileName = path.basename(filePath);
        if (rename) {
            const extension = path.extname(fileName);
            fileName = rename + extension;
        }

        const fileSize = fs.statSync(filePath).size;
        const socket = net.createConnection({ host: hostIP, port: transfer_port }, () => {
            const metadata = { fileName, fileSize };
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
                socket.end();
                resolve();
            });
            fileStream.on('error', (error) => {
                console.error(`\nerror while reading your file (corruption?):`, error.message);
                socket.destroy();
                reject(error);
            });
        });
        socket.on('error', (error) => {
            console.error(`\nerror occured with the connection to the other device:`, error.message);
            reject(error);
        });
    });
}

program
    .command('host')
    .description('start a udp server to allow file receiving on the device')
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
    .description('lists the devices currently hosting a share session on your LAN')
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
    .command('send <hostIP> <filePath>')
    .description('send a file to a host on your LAN')
    .option('--rename <newName>', 'override the original file name for the recieving host')
    .action(async (hostIP, filePath, options) => {
        try {
            console.log(`\nconnecting to ${hostIP}...`);
            await sendFile(hostIP, filePath, options.rename);
        } catch (error) {
            console.error(`error connecting to the host:`, error.message);
        }
    });

program
    .command('speed info')
    .description('small fyi about ethernet technical stuff and their associated speeds')
    .action(async () => {
        console.log("\nfyi regarding ethernet technical terms stuff and their speeds (cuz its confusing sometimes)");
        console.log("slowest to fastest:");
        console.log("\n* Fast Ethernet (100 Mbps) - this is a lie lol its slow as hell");
        console.log("* Gigabit Ethernet (1 Gbps) - now this is actually good");
        console.log("\nafter that, names aren't confusing anymore: 2.5 Gbps > 5 Gbps > 10 Gbps");
        console.log("and after that theres more but these are more enterprise related");
    });

program.parse();