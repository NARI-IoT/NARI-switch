const fs = require('fs');
const path = require('path');

const vectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="120dp"
    android:height="60dp"
    android:viewportWidth="240"
    android:viewportHeight="120">

    <!-- Mechanical Gear Lion Silhouette for Android UI -->
    <!-- Tail & spine arch -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 45,42 C 40,38 38,25 48,20 C 52,18 55,20 53,24 C 50,28 48,33 56,36 C 65,39 72,38 85,40 Z" />

    <!-- Hindquarters / Rear Gear Assembly -->
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="3"
        android:fillColor="#00000000"
        android:pathData="M 75,39 A 16,16 0 1,0 75.1,39 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:fillColor="#00000000"
        android:pathData="M 75,46 A 9,9 0 1,0 75.1,46 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 75,52 A 3,3 0 1,0 75.1,52 Z" />
    <!-- Rear cogs -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 73,36 h 4 v 4 h -4 z M 73,70 h 4 v 4 h -4 z M 56,53 h 4 v 4 h -4 z M 90,53 h 4 v 4 h -4 z M 62,42 l 3,-3 l 3,3 l -3,3 z M 84,64 l 3,-3 l 3,3 l -3,3 z M 62,64 l 3,3 l 3,-3 l -3,-3 z M 84,42 l 3,3 l 3,-3 l -3,-3 z" />

    <!-- Mid-body / Center Gearbox -->
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="3.5"
        android:fillColor="#00000000"
        android:pathData="M 115,36 A 20,20 0 1,0 115.1,36 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2.5"
        android:fillColor="#00000000"
        android:pathData="M 115,44 A 12,12 0 1,0 115.1,44 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 115,52 A 4,4 0 1,0 115.1,52 Z" />
    <!-- Center gear cogs -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 113,33 h 4 v 5 h -4 z M 113,74 h 4 v 5 h -4 z M 92,54 h 5 v 4 h -5 z M 133,54 h 5 v 4 h -5 z M 99,40 l 4,-3 l 3,4 l -4,3 z M 127,68 l 4,-3 l 3,4 l -4,3 z M 99,71 l 4,3 l 3,-4 l -4,-3 z M 127,43 l 4,3 l 3,-4 l -4,-3 z" />

    <!-- Drive Shafts & Linkages -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 75,52 L 115,52 L 115,60 L 75,60 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 88,44 L 102,38 L 105,44 L 91,50 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 87,65 L 102,72 L 99,77 L 84,70 Z" />

    <!-- Forequarters / Shoulder Gear Assembly -->
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="3.5"
        android:fillColor="#00000000"
        android:pathData="M 158,34 A 18,18 0 1,0 158.1,34 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:fillColor="#00000000"
        android:pathData="M 158,42 A 10,10 0 1,0 158.1,42 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 158,48.5 A 3.5,3.5 0 1,0 158.1,48.5 Z" />
    <!-- Shoulder cogs -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 156,31 h 4 v 5 h -4 z M 156,68 h 4 v 5 h -4 z M 137,50 h 5 v 4 h -5 z M 174,50 h 5 v 4 h -5 z M 143,37 l 4,-3 l 3,4 l -4,3 z M 169,63 l 4,-3 l 3,4 l -4,3 z M 143,66 l 4,3 l 3,-4 l -4,-3 z M 169,40 l 4,3 l 3,-4 l -4,-3 z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 115,53 L 158,50 L 159,56 L 115,59 Z" />

    <!-- Mechanical Mane -->
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2.5"
        android:fillColor="#00000000"
        android:pathData="M 152,30 C 158,18 175,14 188,20 C 195,24 200,32 198,42 C 205,44 212,50 210,58 C 208,65 200,70 192,72 L 180,72 C 172,74 162,70 156,65 Z" />
    <!-- Mane gear spikes -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 160,18 l 3,-6 l 5,2 l -2,6 z M 174,14 l 2,-7 l 6,1 l -1,7 z M 188,17 l 5,-5 l 5,4 l -4,5 z M 200,26 l 6,-3 l 3,5 l -6,3 z M 207,38 l 7,-1 l 2,6 l -7,1 z M 210,50 l 7,1 l 0,6 l -7,0 z M 205,62 l 6,4 l -3,5 l -6,-3 z M 194,72 l 3,6 l -5,3 l -3,-6 z" />

    <!-- Head, Roaring Jaw & Snout -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 190,32 L 214,30 L 222,36 L 220,44 L 208,44 L 214,50 L 204,53 L 196,46 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 188,24 L 195,18 L 196,26 Z" />

    <!-- Front Legs -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 154,68 L 150,94 L 158,96 L 162,70 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:fillColor="#00000000"
        android:pathData="M 154,90.5 A 4.5,4.5 0 1,0 154.1,90.5 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 152,98 L 148,116 L 160,116 L 158,98 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 144,116 L 164,116 L 164,120 L 144,120 Z" />

    <!-- Front Leg 2 -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 168,66 L 178,90 L 185,87 L 175,64 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:fillColor="#00000000"
        android:pathData="M 181,84.5 A 4.5,4.5 0 1,0 181.1,84.5 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 180,93 L 192,114 L 204,114 L 186,91 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 188,114 L 208,114 L 208,118 L 188,118 Z" />

    <!-- Hind Legs -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 72,70 L 62,92 L 69,95 L 79,72 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:fillColor="#00000000"
        android:pathData="M 65,89.5 A 4.5,4.5 0 1,0 65.1,89.5 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 64,98 L 68,116 L 80,116 L 71,97 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 66,116 L 84,116 L 84,120 L 66,120 Z" />

    <!-- Hind Leg 2 -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 82,68 L 88,90 L 95,88 L 88,66 Z" />
    <path
        android:strokeColor="#FFFFFF"
        android:strokeWidth="2"
        android:fillColor="#00000000"
        android:pathData="M 91,85 A 4,4 0 1,0 91.1,85 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 91,93 L 102,114 L 112,114 L 97,91 Z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M 100,114 L 116,114 L 116,118 L 100,118 Z" />

</vector>
`;

const targetFile = 'E:/RelayControlApp/app/src/main/res/drawable/ic_make_in_india.xml';
fs.writeFileSync(targetFile, vectorXml.trim(), 'utf8');
console.log('Saved ' + targetFile);

