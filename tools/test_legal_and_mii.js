const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== VERIFYING MAKE IN INDIA & LEGAL PROTECTION IMPLEMENTATION ===\n');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name} -> ${err.message}`);
  }
}

// 1. Check legal-content.js
const legalContent = require('../js/legal-content.js');
test('legal-content has termsVersion 1.1', () => {
  assert.strictEqual(legalContent.termsVersion, '1.1');
});
test('legal-content company is NARI IoT Solutions Company', () => {
  assert.strictEqual(legalContent.company, 'NARI IoT Solutions Company');
});
test('legal-content has Make in India metadata and developer section', () => {
  assert.strictEqual(legalContent.madeInIndia, true);
  const devSec = legalContent.about.sections.find(s => s.title.includes('NARI IoT Solutions Company'));
  assert.ok(devSec, 'Found developer section');
  assert.ok(devSec.paras.some(p => p.includes('Make in India')), 'Mentions Make in India');
});
test('legal-content contains strict lawsuit protection & arbitration clauses', () => {
  const termsStr = JSON.stringify(legalContent.terms);
  assert.ok(termsStr.includes('No warranty'), 'Contains no warranty disclaimer');
  assert.ok(termsStr.includes('Limit of liability'), 'Contains limit of liability clause');
  assert.ok(termsStr.includes('indemnity'), 'Contains indemnity clause');
  assert.ok(termsStr.includes('Arbitration and Conciliation Act, 1996 of India'), 'Specifies Indian Arbitration Act');
  assert.ok(termsStr.includes('exclusive jurisdiction'), 'Specifies exclusive jurisdiction');
  assert.ok(termsStr.includes('waiver of class or representative action') || termsStr.includes('not as part of a group or representative action'), 'Contains group action waiver');
});

// 2. Check legal.js
const legalJs = fs.readFileSync(path.resolve(__dirname, '../js/legal.js'), 'utf8');
test('legal.js defines makeInIndiaBadgeHtml', () => {
  assert.ok(legalJs.includes('function makeInIndiaBadgeHtml()'));
  assert.ok(legalJs.includes('MAKE IN INDIA'));
  assert.ok(legalJs.includes('Developed by NARI IoT Solutions Company'));
  assert.ok(legalJs.includes('makeInIndiaBadgeHtml: makeInIndiaBadgeHtml'));
});
test('legal.js aboutHtml and termsHtml include Make in India badge', () => {
  assert.ok(legalJs.includes('function aboutHtml() {\n    var a = L.about;\n    return makeInIndiaBadgeHtml()'));
  assert.ok(legalJs.includes('function termsHtml() {\n    var t = L.terms;\n    return makeInIndiaBadgeHtml()'));
});

// 3. Check Web App Settings in js/app.js
const appJs = fs.readFileSync(path.resolve(__dirname, '../js/app.js'), 'utf8');
test('app.js Settings sheet displays Make in India badge at top of About option', () => {
  assert.ok(appJs.includes('makeInIndiaBadgeHtml()'));
  assert.ok(appJs.includes('About This App'));
});

// 4. Check Web App SVG Assets
const lionSvgPath = path.resolve(__dirname, '../icons/make-in-india-lion.svg');
const badgeSvgPath = path.resolve(__dirname, '../icons/make-in-india-badge.svg');
test('SVG assets exist and have valid vector content', () => {
  assert.ok(fs.existsSync(lionSvgPath), 'Lion SVG exists');
  assert.ok(fs.existsSync(badgeSvgPath), 'Badge SVG exists');
  const lionContent = fs.readFileSync(lionSvgPath, 'utf8');
  assert.ok(lionContent.includes('<svg') && lionContent.includes('gear-lion'));
  const badgeContent = fs.readFileSync(badgeSvgPath, 'utf8');
  assert.ok(badgeContent.includes('MAKE IN INDIA') && badgeContent.includes('NARI IOT SOLUTIONS COMPANY'));
});

// 5. Check Android LegalContent.kt
const androidLegalKt = fs.readFileSync('E:/RelayControlApp/app/src/main/java/com/example/narismartrelay/LegalContent.kt', 'utf8');
test('Android LegalContent.kt is synced with company and v1.1', () => {
  assert.ok(androidLegalKt.includes('const val TERMS_VERSION = "1.1"'));
  assert.ok(androidLegalKt.includes('const val COMPANY = "NARI IoT Solutions Company"'));
  assert.ok(androidLegalKt.includes('Developed by NARI IoT Solutions Company'));
  assert.ok(androidLegalKt.includes('Arbitration and Conciliation Act, 1996 of India'));
});

// 6. Check Android LegalActivity.kt
const androidLegalAct = fs.readFileSync('E:/RelayControlApp/app/src/main/java/com/example/narismartrelay/LegalActivity.kt', 'utf8');
test('Android LegalActivity.kt renders Make In India header banner', () => {
  assert.ok(androidLegalAct.includes('R.drawable.ic_make_in_india'));
  assert.ok(androidLegalAct.includes('MAKE IN INDIA'));
  assert.ok(androidLegalAct.includes('Developed by NARI IoT Solutions Company'));
});

// 7. Check Android fragment_profile.xml & ProfileFragment.kt
const androidProfileXml = fs.readFileSync('E:/RelayControlApp/app/src/main/res/layout/fragment_profile.xml', 'utf8');
const androidProfileKt = fs.readFileSync('E:/RelayControlApp/app/src/main/java/com/example/narismartrelay/ProfileFragment.kt', 'utf8');
test('Android fragment_profile.xml displays Make in India banner card at top of About', () => {
  assert.ok(androidProfileXml.includes('card_make_in_india'));
  assert.ok(androidProfileXml.includes('@drawable/ic_make_in_india'));
  assert.ok(androidProfileXml.includes('MAKE IN INDIA'));
  assert.ok(androidProfileXml.includes('Developed by NARI IoT Solutions Company'));
  assert.ok(androidProfileKt.includes('card_make_in_india'));
});

// 8. Check Android ic_make_in_india.xml drawable
const androidDrawable = fs.readFileSync('E:/RelayControlApp/app/src/main/res/drawable/ic_make_in_india.xml', 'utf8');
test('Android ic_make_in_india.xml exists and is valid vector', () => {
  assert.ok(androidDrawable.includes('<vector'));
  assert.ok(androidDrawable.includes('android:viewportWidth="240"'));
});

console.log(`\n==== SUMMARY: ${passed}/${total} TESTS PASSED ====\n`);
if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}

