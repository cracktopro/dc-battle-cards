// firebase-config.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyBDx7E1BRInP2toeW-c_BLXsryQ_toPJRI",
    authDomain: "dc-card-battle.firebaseapp.com",
    projectId: "dc-card-battle",
    storageBucket: "dc-card-battle.appspot.com",
    messagingSenderId: "389571370658",
    appId: "1:389571370658:web:eb9c69029ce677aab201fb"
  };
  

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

export { auth, database };
