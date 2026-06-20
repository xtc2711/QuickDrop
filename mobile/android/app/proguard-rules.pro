# Add project specific ProGuard rules here.
# WebView + WebRTC 保留规则
-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepclassmembers class com.quickdrop.app.webview.JSBridge {
    @android.webkit.JavascriptInterface <methods>;
}
# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
# Gson
-keepattributes Signature
-keep class com.google.gson.** { *; }
