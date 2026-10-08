package io.github.gajendrasinghdawar.lali.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.github.gajendrasinghdawar.lali.R

val NotoSans = FontFamily(
  Font(R.font.noto_sans_regular, FontWeight.Normal),
  Font(R.font.noto_sans_semibold, FontWeight.SemiBold),
)

val Typography =
  Typography(
    bodyLarge =
      TextStyle(
        fontFamily = NotoSans,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.sp,
      ),
    bodyMedium =
      TextStyle(
        fontFamily = NotoSans,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp, // Match web 0.9375rem
        lineHeight = 24.sp, // Match web line-height 1.65 approx
        letterSpacing = 0.sp,
      ),
    titleLarge = 
      TextStyle(
        fontFamily = NotoSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp, // Match web heading-1 ~1.35rem
        lineHeight = 28.sp,
        letterSpacing = 0.sp
      ),
    titleMedium = 
      TextStyle(
        fontFamily = NotoSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp, // Match web heading-2 ~1.15rem
        lineHeight = 24.sp,
        letterSpacing = 0.sp
      ),
    titleSmall = 
      TextStyle(
        fontFamily = NotoSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp, // Match web heading-3 ~1rem
        lineHeight = 24.sp,
        letterSpacing = 0.sp
      ),
    labelLarge = TextStyle(fontFamily = NotoSans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = NotoSans, fontSize = 12.sp),
    bodySmall = TextStyle(fontFamily = NotoSans, fontSize = 12.sp, lineHeight = 18.sp),
  )
