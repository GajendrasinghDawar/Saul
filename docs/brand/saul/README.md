# Saul Guardian

A geometric guardian mask. Four solid pieces form a watchful face. Jade side panels protect an amber core. A crimson crown gives the mark direction. The carved, angular shapes give it a tribal-inspired feel. It does not copy a symbol from a specific culture. It is not a letter or a claim that Saul has achieved AGI.

Open `preview.html` to see the chosen design, two alternatives, small sizes, and Android masks. The web favicon and Android launcher resources now use Guardian.

## Reusable files

- `saul-mark.svg`: three-color logo with a transparent background. No fonts required.
- `saul-mark-1024.png`: transparent 1024 pixel logo.
- `saul-mark-light.svg`: light monochrome version for uses that require one color.
- `favicon.svg`: web icon on a rounded slate background.
- `favicon.ico`: 16, 32, and 48 pixel fallback icons.
- `favicon-32.png`: 32 pixel web icon.
- `apple-touch-icon.png`: opaque 180 pixel touch icon. The OS sets its mask.
- `saul-icon-512.png`: opaque square artwork. This is not a full store submission.
- `android/`: adaptive vectors, a separate monochrome layer, and legacy PNGs at five densities.

## Exact colors

Use Jade9 `#28A382`, Crimson9 `#EA3E83`, and Amber9 `#FFC53D` from Android `theme/Color.kt`. Use Slate1 `#101012` behind app icons. The neutral background is not part of the three-color mark.

Keep the gaps and proportions. Do not add shadows, gradients, strokes, or small details. Use the color SVG for normal logos. Android launchers choose the colors for themed icons; do not put brand colors in the monochrome layer.

## Installed resources

Web icons are in `web/public/`. `web/index.html` links the SVG, ICO fallback, and touch icon. The web tab and Android launcher display the name Saul. The Android package ID is unchanged.

The in-app web mark is in `web/src/assets/saul-mark.svg`. The shared `SaulBrand` and `SaulMark` components use it on account pages, in the sidebar, and in chat.

Android resources are in `android/app/src/main/res/`. The manifest already uses `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`. Each adaptive layer is 108 dp. The foreground uses a 0.6 scale and a 15.6 dp offset. The mark fits within the central 66 dp safe circle. Keep the foreground separate from its background; let the launcher set the mask.

The old legacy WebP files were replaced with PNGs. Do not keep PNG and WebP resources with the same name in one density folder.

If you change the source SVG, export all PNG and ICO files again. Keep the web SVG and Android path data equal to the source SVG. Check the icon at 16 pixels, on light and dark surfaces, and in an actual launcher. Check themed icons too.

Primary source: [Android adaptive icon requirements](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).
