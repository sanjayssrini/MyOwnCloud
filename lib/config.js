import path from "node:path";

export const IS_VERCEL = Boolean(process.env.VERCEL);

const defaultDataDirectory = IS_VERCEL ? "/tmp/myowncloud" : path.resolve(process.cwd(), "data");

export const DATA_DIRECTORY = process.env.MYOWNCLOUD_DATA_DIR || defaultDataDirectory;
export const DATABASE_PATH = path.join(DATA_DIRECTORY, "myowncloud.sqlite");
