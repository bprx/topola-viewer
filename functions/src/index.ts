/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions/v2";
import {onCall, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as path from "path";
import * as fs from "fs";

setGlobalOptions({region: "asia-southeast1"});

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

export const helloWorld = onCall({
  cors: [
    // "http://localhost:5000",
    "https://famtree-440108.web.app",
    "https://famtree-440108.firebaseapp.com",
  ],
  region: "asia-southeast1",
}, (request) => {
  if (!request.auth) return null;
  logger.info(`helloWorld using onCall log: pwd = ${path.resolve(".")}`, {
    structuredData: true,
  });
  try {
    const content = fs.readFileSync(path.resolve("./src/assets/hello.txt"));
    return `Hello from functions onCall: ${content}`;
  } catch (error) {
    return `Hello from functions onCall: ${error}`;
  }
});

export const familyTree = onRequest({
  cors: false,
}, (request, response) => {
  logger.info(`familyTree log: pwd = ${path.resolve(".")}`, {
    structuredData: true,
  });
  const content = fs.readFileSync(path.resolve("./src/assets/family_tree.ged"));
  response.send(content);
});
