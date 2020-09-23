#!/usr/bin/env node
const { Command } = require("commander");
const ytpl = require('ytpl');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');
const Spinnies = require('spinnies');
const { Console } = require("console");


async function main() {
    const program = new Command();
    program.version('0.0.1').description("A simple node-cli youtube downloader");

    program
        .requiredOption('-l, --link <link>', 'A youtube video link or id')
        .option('-o, --output [directory]', 'Directory of the downloaded files', './')
        .option('-c, --concurrency [concurrency]', 'Number of concurrent downloads', myParseInt, 5)
        .option('--offset [offset]', 'First video to start downloadind from playlist', myParseInt, 0)
        .option('--limit [limit]', 'Limit of videos to download from playlist', myParseInt, Infinity)
        .action(async (cmObj) => {
            let { link, output, concurrency, limit, offset } = cmObj;
            let spinnies = new Spinnies();
            try {
                let playlist = await getPLaylist({ playlistLink: link });
                console.log(`Playlist ${playlist.title} Found. Total Items: ${playlist.total_items}`);
                console.log(`Downloading only ${limit} videos starting from video ${offset + 1}...`);
                let outputDir = path.join(output, playlist.title);
                mkDirByPathSync(outputDir);
                let plimit = pLimit(concurrency);
                let promises = playlist.items.slice(offset, offset + limit).map((item) => {
                    return plimit(() => {
                        return downloadVideo({ title: item.title, url: item.url, outputDir, spinnies });
                    });
                });
                const result = await Promise.all(promises);
                console.log(`Finished downloading ${result.length} videos.`);
                process.exit(0);
            } catch (error) {
                if (error.code == 404) {
                    console.log("Playlist not found. Trying to download video instead.");
                    try {
                        const info = await ytdl.getBasicInfo(link);
                        mkDirByPathSync(output);
                        const videoResponse = await downloadVideo({
                            title: info.videoDetails.title,
                            url: info.videoDetails.video_url,
                            outputDir: output,
                            spinnies
                        });
                    } catch (e) {
                        console.error("Error while trying to donwload single video", e);
                        process.exit(1);
                    }
                } else {
                    console.error("Error: ", error);
                }
            }
        });
    await program.parse(process.argv);
}

if (require.main === module) {
    main();
}

async function getPLaylist({ playlistLink }) {
    if (!playlistLink) {
        return Promise.reject({ code: 400, message: "No playlist link provided" });
    }
    try {
        let playlist = await ytpl(playlistLink, { limit: Infinity, });
        return playlist;
    } catch (err) {
        return Promise.reject({ code: 404, message: "Playlist link or id not found", err });
    }
}

async function downloadVideo({ title, url, outputDir, spinnies }) {
    return new Promise((resolve, reject) => {
        const video = ytdl(url, { filter: format => format.container === 'mp4' });
        const downloadText = `Downloading ${title}`;
        spinnies.add(title, { text: downloadText });
        let starttime;
        video.pipe(fs.createWriteStream(path.join(outputDir, `${title}.mp4`)));
        video.once('response', () => {
            starttime = Date.now();
        });
        video.on('progress', (chunkLength, downloaded, total) => {
            const percent = downloaded / total;
            const downloadedMinutes = (Date.now() - starttime) / 1000 / 60;
            const estimatedDownloadTime = (downloadedMinutes / percent) - downloadedMinutes;
            spinnies.update(title, {
                text: downloadText
                    + `, Completed: ${(percent * 100).toFixed(2)}%`
                    + `, ${(downloaded / 1024 / 1024).toFixed(2)}MB of ${(total / 1024 / 1024).toFixed(2)}MB`
                    + `, estimated time left: ${estimatedDownloadTime.toFixed(2)}minutes`
            });
        });
        video.on('end', () => {
            const message = `Finished downloading ${title}`;
            spinnies.succeed(title, { text: message });
            resolve(message);
        });
        video.on('error', (err) => {
            spinnies.fail(title, { text: `Failed to download ${title}` });
            reject(err);
        });
    });
}

function mkDirByPathSync(targetDir, { isRelativeToScript = false } = {}) {
    const sep = path.sep;
    const initDir = path.isAbsolute(targetDir) ? sep : '';
    const baseDir = isRelativeToScript ? __dirname : '.';

    return targetDir.split(sep).reduce((parentDir, childDir) => {
        const curDir = path.resolve(baseDir, parentDir, childDir);
        try {
            fs.mkdirSync(curDir);
        } catch (err) {
            if (err.code === 'EEXIST') { // curDir already exists!
                return curDir;
            }

            // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
            if (err.code === 'ENOENT') { // Throw the original parentDir error on curDir `ENOENT` failure.
                throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`);
            }

            const caughtErr = ['EACCES', 'EPERM', 'EISDIR'].indexOf(err.code) > -1;
            if (!caughtErr || caughtErr && curDir === path.resolve(targetDir)) {
                throw err; // Throw if it's just the last created dir.
            }
        }

        return curDir;
    }, initDir);
}

function myParseInt(value, dummyPrevious) {
    // parseInt takes a string and an optional radix
    return parseInt(value);
}