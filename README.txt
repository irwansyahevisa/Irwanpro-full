IrwanPro-Full (React Native + Expo) - Project ZIP
------------------------------------------------
What is included:
- App.js (full prototype with EMA+Fibonacci logic, CSV logging, notifications placeholder)
- package.json (basic deps for Expo)
- README with quick start instructions

Quick start (using Snack.expo.dev on Android phone):
1. Open https://snack.expo.dev in your phone browser.
2. Create new project, replace App.js content with the App.js file from this ZIP (open file in archive or copy).
3. Save and run -> choose 'Open in Expo Go' to test app on your phone.
4. To build a standalone APK: go to https://expo.dev, import project, and use 'Build -> Android -> APK' (EAS).

Notes:
- The project uses fake candle generator for testing. Replace the data source with your broker/API for real signals.
- Notifications use expo-notifications for local notifications; push notifications require server/config.
- For MT4/MT5 execution, implement a server-side bridge and secure credentials.
