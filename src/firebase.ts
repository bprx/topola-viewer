// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDDpi1gMzYsHHeZbtiwvCyF5FlHG1YKV1o",
    authDomain: "famtree-440108.firebaseapp.com",
    projectId: "famtree-440108",
    storageBucket: "famtree-440108.appspot.com",
    messagingSenderId: "704208865987",
    appId: "1:704208865987:web:a9b917aabcadbb7c753076"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, "asia-southeast1");
// connectAuthEmulator(auth, "http://127.0.0.1:9099");
// connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const helloWorld = httpsCallable(functions, "helloWorld");
const familyTree = httpsCallable(functions, "familyTree");

export { auth, helloWorld, familyTree };
