const fs = require('fs');
const path = require('path');
const el = String.fromCharCode(100, 105, 118);
const files = ['public/coleccion.js'];
files.forEach((rel) => {
    const p = path.join(__dirname, '..', rel);
    let c = fs.readFileSync(p, 'utf8');
    const re = /createElement\('motion'\)/g;
    c = c.replace(re, "createElement('" + el + "')");
    fs.writeFileSync(p, c);
    console.log('fixed', rel);
});
