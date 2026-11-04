const fs = require('fs');
const path = require('path');

const file = 'E:/RelayControlApp/app/src/main/java/com/example/narismartrelay/LegalActivity.kt';
let code = fs.readFileSync(file, 'utf8');

// 1. Add ImageView import
if (!code.includes('import android.widget.ImageView')) {
  code = code.replace(
    'import android.widget.CheckBox',
    'import android.widget.CheckBox\nimport android.widget.ImageView'
  );
}

// 2. Add Make In India banner before title in onCreate
const target = '        val title = when (mode) {';
const bannerCode = `        // Make in India & Developer Attribution Header
        val miiBanner = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val miiIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_make_in_india)
            layoutParams = LinearLayout.LayoutParams(dp(54), dp(28)).apply { marginEnd = dp(12) }
        }
        val miiCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val miiTitleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        miiTitleRow.addView(TextView(this).apply {
            text = "MAKE IN INDIA"
            setTextColor(Color.WHITE)
            textSize = 12f
            setTypeface(typeface, Typeface.BOLD)
            letterSpacing = 0.08f
        })
        val flagBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(dp(28), dp(3)).apply { marginStart = dp(8) }
            addView(View(this@LegalActivity).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f); setBackgroundColor(Color.parseColor("#FF9933")) })
            addView(View(this@LegalActivity).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f); setBackgroundColor(Color.WHITE) })
            addView(View(this@LegalActivity).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f); setBackgroundColor(Color.parseColor("#138808")) })
        }
        miiTitleRow.addView(flagBar)
        miiCol.addView(miiTitleRow)
        miiCol.addView(TextView(this).apply {
            text = "Developed by NARI IoT Solutions Company"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
        })
        miiBanner.addView(miiIcon)
        miiBanner.addView(miiCol)
        root.addView(miiBanner)

        val title = when (mode) {`;

if (!code.includes('MAKE IN INDIA')) {
  code = code.replace(target, bannerCode);
}

fs.writeFileSync(file, code, 'utf8');
console.log('Patched LegalActivity.kt successfully');

