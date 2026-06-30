plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.quickdrop.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.quickdrop.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // 生产环境地址（与 iOS AppConfig 一致）
            buildConfigField("String", "AUTH_BASE_URL", "\"https://signal.quickdrop.app/api/v1\"")
            buildConfigField("String", "SIGNAL_WS_URL", "\"wss://signal.quickdrop.app\"")
        }
        debug {
            isMinifyEnabled = false
            // 开发环境：10.0.2.2 是 Android 模拟器中宿主机的 localhost
            buildConfigField("String", "AUTH_BASE_URL", "\"http://10.0.2.2:3003/api/v1\"")
            buildConfigField("String", "SIGNAL_WS_URL", "\"ws://10.0.2.2:3002\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    // AndroidX 核心
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.fragment:fragment-ktx:1.6.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")

    // Material Design 3
    implementation("com.google.android.material:material:1.11.0")

    // WebView + WebRTC (Android 内置支持，无需额外依赖)
    // WebKit 用于高级 WebView 特性
    implementation("androidx.webkit:webkit:1.9.0")

    // CameraX — 扫码功能
    val cameraxVersion = "1.3.1"
    implementation("androidx.camera:camera-core:$cameraxVersion")
    implementation("androidx.camera:camera-camera2:$cameraxVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraxVersion")
    implementation("androidx.camera:camera-view:$cameraxVersion")

    // ML Kit 条码扫描（Google Play Services 可用时）
    implementation("com.google.mlkit:barcode-scanning:17.2.0")

    // 网络
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JSON 解析
    implementation("com.google.code.gson:gson:2.10.1")

    // 加密存储
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // 协程
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // 测试
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
