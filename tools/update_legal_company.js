const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../js/legal-content.js');
let content = fs.readFileSync(file, 'utf8');

// Update company name
content = content.replace(/company:\s*"NARI IoT Solutions"/g, 'company: "NARI IoT Solutions Company"');
content = content.replace(/title:\s*"Developed by NARI IoT Solutions"/g, 'title: "Developed by NARI IoT Solutions Company"');
content = content.replace(/is designed and developed in India by NARI IoT Solutions\./g, 'is designed, engineered, and developed in India by NARI IoT Solutions Company under the Make in India initiative.');
content = content.replace(/Website: narismarthome\.com\s+\|\s+Smart IoT Solutions/g, 'Developed by NARI IoT Solutions Company | Website: narismarthome.com | Make in India');
content = content.replace(/product of NARI IoT Solutions\./g, 'product of NARI IoT Solutions Company. Proudly Made in India.');
content = content.replace(/owned by NARI IoT Solutions \(\\"NARI\\", \\"we\\", \\"us\\"\)\./g, 'owned by NARI IoT Solutions Company (\\"NARI IoT Solutions\\", \\"we\\", \\"us\\").');
content = content.replace(/NARI IoT Solutions, its owners, partners/g, 'NARI IoT Solutions Company, its owners, partners');
content = content.replace(/defend and compensate NARI IoT Solutions and its owners/g, 'defend and compensate NARI IoT Solutions Company and its owners');
content = content.replace(/belong to NARI IoT Solutions or its licensors/g, 'belong to NARI IoT Solutions Company or its licensors');
content = content.replace(/registered office of NARI IoT Solutions/g, 'registered office of NARI IoT Solutions Company');
content = content.replace(/city of NARI IoT Solutions' registered office/g, 'city of NARI IoT Solutions Company\'s registered office');
content = content.replace(/between you and NARI IoT Solutions about the App/g, 'between you and NARI IoT Solutions Company about the App');
content = content.replace(/NARI IoT Solutions - Website: https:\/\/narismarthome\.com/g, 'NARI IoT Solutions Company - Website: https://narismarthome.com');
content = content.replace(/© 2026 NARI IoT Solutions\./g, '© 2026 NARI IoT Solutions Company.');

fs.writeFileSync(file, content, 'utf8');
console.log('Updated js/legal-content.js successfully');

