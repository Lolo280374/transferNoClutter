<p align=center><br>
<a href="https://github.com/Lolo280374/transferNoClutter/"><img src="https://hackatime-badge.hackclub.com/U09CBF0DS4F/transferNoClutter"></a>
<a href="http://makeapullrequest.com"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
<a href="#npm-linux-macos-windows"><img src="https://img.shields.io/badge/os-linux-brightgreen"></a>
<a href="#npm-linux-macos-windows"><img src="https://img.shields.io/badge/os-mac-brightgreen"></a>
<a href="#npm-linux-macos-windows"><img src="https://img.shields.io/badge/os-windows-brightgreen"></a>
<br></p>

<p align="center"><br><a href="https://www.npmjs.com/package/transfernoclutter" title="npm downloads stats"><img src="https://img.shields.io/npm/dt/transfernoclutter" alt="npm downloads 
stats"></a>
<a href="https://www.npmjs.com/package/transfernoclutter" title="npm version"><img src="https://img.shields.io/npm/v/transfernoclutter" alt="npm version"></a></p>

<h3 align="center">
transfer files (even massives one) fully on your LAN, using a fully headless CLI tool!</a>
</h3>

<h1 align="center">
    showcases
</h1>

to view the project's showcases, please click on one of the two video avalaible. the first video showcases the main file transfer part of the project, while the second video showcases the speedtest part.

<a href="https://cdn.lolodotzip.tech/transfernoclutter/transfer_showcase.mp4">
  <img src="https://github.com/user-attachments/assets/f8225b73-0f47-4bd7-a859-fd36ce2fa3d6" 
       alt="File transfer showcase" 
       width="1655" 
       height="929">
</a>

<a href="https://cdn.lolodotzip.tech/transfernoclutter/speedtest_showcase.mp4">
  <img src="https://github.com/user-attachments/assets/617ac60e-e67a-4c21-abbd-fdb17994e209" 
       alt="Speedtesting tool showcase" 
       width="1648" 
       height="929">
</a>

## table of contents

- [compatibility](#compatibility)
- [features](#features)
- [commands list](#commands)
- [installation](#installation)
    - [with npm: Linux, macOS, Windows](#npm-linux-macos-windows)
    - [install from source](#install-from-source)
- [uninstall](#uninstall)
- [reporting issues](#reporting-issues)
- [privacy information](#privacy-disclaimer)
- [license](#license)

## compatibility

this project works and can be installed on any device running nodeJS, that being mostly Linux, Windows, and macOS, but it can be installed on Android with terminal emulators for example!
<br>compatibility with devices running anything else than macOS, Linux, or Windows has been untested and is gonna be random.

## features
this project was originally meant to just be a file transfer tool, but it became a bit more than that! with this project, you may:
- **transfer files** from a device to another, cross-platform, by just installing a npm package!
- **make sure the files didn't get corrupted** (that's not really a feature but it's a good thing to have ig)
- **test the max capabilities of your network card** with a fully LAN-based speedtest tool!
- **host a file sharing server and a speedtest server** fully headless, just on a CLI!

## commands

here's a list of commands, organized by category:

**file sharing/transfer**
- **transfer host [--path '/home/lolodotzip/hi']** : start a share server allowing you to recieve files on the device you start it on. you may use '--path' to recieve files to a specific path.
- **transfer discover** : lists all the devices currently hosting a share session on your LAN.
- **transfer send <IP/ID/hostname> <filePath> [--rename "newName"]** : sends the file you pass in the <filePath> argument to the device you specify. you may use the device's hostname, IP address, or ID (the last octet of the IP, e.g '31' for '192.168.1.31'). you can also use '--rename' to edit the file name the device will recieve.

**speed testing**
- **transfer speed info** : small reminder about the technical terms of Ethernet and it's designations.
- **transfer speed host** : start a speedtest server for another device to test it's max LAN speed.
- **transfer speed test <IP/ID/hostname>** : runs a 10 second test on the speedtest server host, testing the max possible speed. you may either use the host's IP address, hostname, or ID (the last octet of the IP, e.g '31' for '192.168.1.31').

## installation
### npm: Linux, macOS, Windows
you can install this project by simply getting it from npm:
```sh
npm install -g transfernoclutter
transfer help
```

### install from source
to install from source, you must start by making sure you have git, nodeJS, and npm installed.
then, start by cloning the repository:

```sh
git clone https://github.com/Lolo280374/transfernoclutter.git
cd transfernoclutter
```
you may then install the dependencies, and link the package to your system:
```sh
npm install
npm link
```
once complete, you can run the following to make sure the installation suceeded, and you can start editing 'index.js' to make modifs!
```sh
transfer help
```

## uninstall
to uninstall, you can simply run the following:
```sh
npm uninstall transfernoclutter
```

## reporting issues

this is a community project, and your help is very much appreciated! if you notice anything wrong durign your usage of this project, please report it on the [GitHub issues tracker](https://github.com/Lolo280374/transfernoclutter/issues)!

## privacy disclaimer

this tool dosen't collect any analytics of any sort, nor makes connections to the outside of the Internet. all the connections made are being made on your LAN (Local Area Network), meaning it's all private!

## license

this project is licensed under the MIT license. you can check it [here](https://github.com/Lolo280374/transfernoclutter/blob/master/LICENSE/).
<br>if you have any questions about this project, please reach me [at lolodotzip@hackclub.app](mailto:lolodotzip@hackclub.app).