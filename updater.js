const https = require('https');
const { version: CURRENT_VERSION } = require('./package.json');

const REPO = 'Blu8print/YTS-AI-stream-movies-';

let updateInfo = { available: false, version: null, url: null };

function checkForUpdate() {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${REPO}/releases/latest`,
    headers: { 'User-Agent': 'yts-ai-player-updater' },
  };

  https.get(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latest = release.tag_name?.replace(/^v/, '');
        if (latest && latest !== CURRENT_VERSION) {
          updateInfo = { available: true, version: release.tag_name, url: release.html_url };
          console.log(`Update available: ${release.tag_name}`);
        }
      } catch (_) {}
    });
  }).on('error', () => {});
}

function getUpdateInfo() {
  return updateInfo;
}

module.exports = { checkForUpdate, getUpdateInfo };
