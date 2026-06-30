# 下载目录

将各平台的安装包放在此目录中，对应文件名为：

| 文件名 | 平台 | 说明 |
|--------|------|------|
| `quickdrop-macos.dmg` | macOS | 通过 `npm run tauri build` 生成 |
| `quickdrop-windows.msi` | Windows | 通过 `npm run tauri build` 跨平台编译 |
| `quickdrop-android.apk` | Android | 通过 Android Studio 生成 |
| `quickdrop-ios.ipa` | iOS | 通过 Xcode 打包 |

## 打包命令

### macOS (.dmg)

```bash
cd desktop
npm run tauri build
# 产物位置: src-tauri/target/release/bundle/dmg/QuickDrop_1.0.0_x64.dmg
```

### Windows (.msi)

需要在 Windows 机器上：
```bash
cd desktop
npm run tauri build
# 产物位置: src-tauri/target/release/bundle/msi/QuickDrop_1.0.0_x64_en-US.msi
```

### Android (.apk)

```bash
cd mobile/android
./gradlew assembleRelease
# 产物位置: app/build/outputs/apk/release/app-release.apk
```

### iOS (.ipa)

```bash
cd mobile/ios
xcodebuild -workspace QuickDrop.xcworkspace -scheme QuickDrop -configuration Release
# 产物位置: ~/Library/Developer/Xcode/DerivedData/.../Build/Products/Release-iphoneos/QuickDrop.ipa
```

## 上传后

将生成的文件复制到本目录：

```bash
# macOS
cp desktop/src-tauri/target/release/bundle/dmg/*.dmg website/downloads/quickdrop-macos.dmg

# Windows (在 Windows 上)
copy desktop\src-tauri\target\release\bundle\msi\*.msi website\downloads\quickdrop-windows.msi
```

然后刷新页面（http://localhost:3000）即可下载。
