const fs = require("fs");
const Path = require("path");

function deleteFolderRecursive(p) {
  if (fs.existsSync(p)) {
    fs.readdirSync(p).forEach((file) => {
      const curPath = Path.join(p, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(p);
  }
}

const subFolder = process.argv.slice(2)[0];
const folder = subFolder
  ? Path.join(__dirname, "..", "./dist", subFolder)
  : Path.join(__dirname, "..", "./dist");

deleteFolderRecursive(folder);
