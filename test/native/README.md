# Native Seerr transport regression

This harness exercises the production `SeerrClient.java` against an ephemeral local HTTP server. It verifies cookie persistence, CSRF headers, profile isolation, Quick Connect initiation/authentication, safe response fields, request submission, blocked redirects and endpoints, failed-login cleanup and disconnect. It never connects to a real Seerr server.

Requirements: JDK 17+, Android SDK platform 36, and `org.json:json:20240303` (test runtime only). Set `JSON_JAR` to that jar's location.

```sh
mkdir -p /tmp/ember-seerr-native-test
"$JAVA_HOME/bin/javac" -cp "$JSON_JAR:$ANDROID_HOME/platforms/android-36/android.jar" -d /tmp/ember-seerr-native-test platforms/firetv/app/src/main/java/tv/ember/jellyfin/SeerrClient.java test/native/SeerrClientTest.java
"$JAVA_HOME/bin/java" -cp "/tmp/ember-seerr-native-test:$JSON_JAR:$ANDROID_HOME/platforms/android-36/android.jar" tv.ember.jellyfin.SeerrClientTest
```

The browser flows use the platform's real JavaScript adapter and a fake Android endpoint. They cover automatic connection through the current Jellyfin profile, identity and server checks, cancellation, disabled Quick Connect, manual account fallback, and discovery/request behavior:

```sh
npm run test:seerr
```

Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` when Playwright/Chromium are installed outside this repository.
