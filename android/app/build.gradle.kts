import java.net.URI

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

val releaseVersionCode = providers.gradleProperty("saul.versionCode")
val releaseVersionName = providers.gradleProperty("saul.versionName")
val signingStore = providers.environmentVariable("ANDROID_KEYSTORE_PATH")
val signingStorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD")
val signingAlias = providers.environmentVariable("ANDROID_KEY_ALIAS")
val signingKeyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD")
val gatewayBaseUrl = providers.gradleProperty("lali.gatewayBaseUrl")
val webBaseUrl = providers.gradleProperty("lali.webBaseUrl")

val validateReleaseConfiguration = tasks.register("validateReleaseConfiguration") {
    doLast {
        require(releaseVersionCode.orNull?.toIntOrNull()?.let { it > 0 } == true) {
            "Release requires -Psaul.versionCode=<positive integer>; increase it for every update."
        }
        require(!releaseVersionName.orNull.isNullOrBlank()) {
            "Release requires -Psaul.versionName=<version>."
        }
        listOf(gatewayBaseUrl, webBaseUrl).forEach { value ->
            val uri = value.orNull?.let { URI(it) }
            require(uri?.scheme == "https" && !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
                "Release requires HTTPS lali.gatewayBaseUrl and lali.webBaseUrl without credentials, queries or fragments."
            }
        }
        require(listOf(signingStore, signingStorePassword, signingAlias, signingKeyPassword)
            .all { !it.orNull.isNullOrBlank() }) {
            "Release requires ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD."
        }
        require(file(signingStore.get()).isFile) { "Release keystore does not exist." }
    }
}

android {
    namespace = "io.github.gajendrasinghdawar.lali"
    compileSdk = 37
    defaultConfig {
        applicationId = "io.github.gajendrasinghdawar.lali"
        minSdk = 24
        targetSdk = 37
        versionCode = releaseVersionCode.orNull?.toIntOrNull() ?: 1
        versionName = releaseVersionName.getOrElse("1.0")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            storeFile = signingStore.orNull?.let { file(it) }
            storePassword = signingStorePassword.orNull
            keyAlias = signingAlias.orNull
            keyPassword = signingKeyPassword.orNull
        }
    }

    buildTypes {
        debug {
            // 10.0.2.2 is the Android emulator's alias for the host loopback interface.
            buildConfigField("String", "GATEWAY_BASE_URL", "\"${gatewayBaseUrl.getOrElse("http://10.0.2.2:3000")}\"")
            buildConfigField("String", "WEB_BASE_URL", "\"${webBaseUrl.getOrElse("http://10.0.2.2:5173")}\"")
        }
        release {
            // Release builds only permit HTTPS (see res/xml/network_security_config.xml).
            signingConfig = signingConfigs.getByName("release")
            buildConfigField("String", "GATEWAY_BASE_URL", "\"${gatewayBaseUrl.getOrElse("")}\"")
            buildConfigField("String", "WEB_BASE_URL", "\"${webBaseUrl.getOrElse("")}\"")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = true
      shaders = false
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    dependsOn(validateReleaseConfiguration)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation("org.commonmark:commonmark:0.30.0")
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)

  // Gateway HTTP
  implementation(libs.ktor.client.core)
  implementation(libs.ktor.client.okhttp)
  implementation(libs.ktor.client.auth)
  implementation(libs.ktor.client.content.negotiation)
  implementation(libs.ktor.serialization.kotlinx.json)
  testImplementation(libs.ktor.client.mock)
  testImplementation("io.ktor:ktor-client-cio:${libs.versions.ktor.get()}")
  
  // Custom Tabs
  implementation(libs.androidx.browser)
}
