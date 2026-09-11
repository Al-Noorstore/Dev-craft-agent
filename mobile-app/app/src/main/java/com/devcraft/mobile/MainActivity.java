package com.devcraft.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    private WebView web;
    private TextToSpeech tts;
    private static final int REQ_PERM = 7;
    private static final int REQ_SPEECH = 8;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            public void onInit(int status) {
                if (status == TextToSpeech.SUCCESS) {
                    tts.setLanguage(new Locale("ur", "PK"));
                }
            }
        });

        web = new WebView(this);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    private boolean hasPerm(String p) {
        if (Build.VERSION.SDK_INT < 23) return true;
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private void askPerm(String[] ps) {
        if (Build.VERSION.SDK_INT >= 23) {
            runOnUiThread(new Runnable() {
                public void run() {
                    List<String> need = new ArrayList<String>();
                    if (!hasPerm(Manifest.permission.CALL_PHONE)) need.add(Manifest.permission.CALL_PHONE);
                    if (!hasPerm(Manifest.permission.SEND_SMS)) need.add(Manifest.permission.SEND_SMS);
                    if (!hasPerm(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    if (!need.isEmpty()) {
                        String[] arr = new String[need.size()];
                        for (int i = 0; i < need.size(); i++) arr[i] = need.get(i);
                        requestPermissions(arr, REQ_PERM);
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SPEECH && resultCode == RESULT_OK && data != null) {
            ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            String text = (results != null && !results.isEmpty()) ? results.get(0) : "";
            final String safe = text.replace("\\", "\\\\").replace("'", "\'");
            web.post(new Runnable() {
                public void run() {
                    web.evaluateJavascript("window.onVoiceResult('" + safe + "')", null);
                }
            });
        }
    }

    public class Bridge {

        @JavascriptInterface
        public String info() {
            return Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE;
        }

        @JavascriptInterface
        public String battery() {
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return pct + "%";
        }

        @JavascriptInterface
        public String placeCall(final String number) {
            if (!hasPerm("android.permission.CALL_PHONE")) {
                askPerm(null);
                return "PERMISSION_REQUESTED: call permission mangi gayi - allow kar ke dobara try karo";
            }
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + number)));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Call fail: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
            return "CALLING: " + number;
        }

        @JavascriptInterface
        public String dialCall(final String number) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number)));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Dial fail", Toast.LENGTH_SHORT).show();
                    }
                }
            });
            return "DIAL: " + number + " (call button khud dabana hoga)";
        }

        @JavascriptInterface
        public String sendSms(final String number, final String msg) {
            if (!hasPerm("android.permission.SEND_SMS")) {
                askPerm(null);
                return "PERMISSION_REQUESTED: SMS permission mangi gayi - allow kar ke dobara try karo";
            }
            try {
                android.telephony.SmsManager.getDefault().sendTextMessage(number, null, msg, null, null);
                return "SMS_SENT: " + number;
            } catch (Exception e) {
                return "SMS_FAIL: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public String vibrate(final int ms) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                        v.vibrate(ms > 0 && ms < 10000 ? ms : 500);
                    } catch (Exception e) { }
                }
            });
            return "VIBRATE " + (ms > 0 ? ms : 500) + "ms";
        }

        @JavascriptInterface
        public String torch(final boolean on) {
            try {
                CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
                String id = cm.getCameraIdList()[0];
                cm.setTorchMode(id, on);
                return on ? "TORCH_ON" : "TORCH_OFF";
            } catch (Exception e) {
                return "TORCH_FAIL: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String speak(String text) {
            if (tts != null) {
                tts.speak(text, TextToSpeech.QUEUE_ADD, null, "dcd");
                return "SPEAKING";
            }
            return "TTS_FAIL";
        }

        @JavascriptInterface
        public void listen() {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ur-PK");
                        startActivityForResult(i, REQ_SPEECH);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Voice input support nahi", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public String apps() {
            try {
                Intent main = new Intent(Intent.ACTION_MAIN, null);
                main.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> list = getPackageManager().queryIntentActivities(main, 0);
                StringBuilder sb = new StringBuilder();
                int n = 0;
                for (ResolveInfo ri : list) {
                    sb.append(ri.activityInfo.packageName).append("\n");
                    n++;
                    if (n >= 150) break;
                }
                return n + " apps installed:\n" + sb.toString();
            } catch (Exception e) {
                return "APPS_FAIL: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public String openApp(final String pkg) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                        if (i != null) startActivity(i);
                        else Toast.makeText(MainActivity.this, "App nahi mili: " + pkg, Toast.LENGTH_SHORT).show();
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Open fail", Toast.LENGTH_SHORT).show();
                    }
                }
            });
            return "OPEN: " + pkg;
        }

        @JavascriptInterface
        public String share(final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(i, "Share karo"));
                }
            });
            return "SHARE";
        }

        @JavascriptInterface
        public String installApp(final String query) {
            final boolean isPkg = query != null && query.contains(".") && !query.contains(" ");
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        String uri = isPkg ? ("market://details?id=" + query) : ("market://search?q=" + Uri.encode(query));
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception e) {
                        try {
                            String url = isPkg ? ("https://play.google.com/store/apps/details?id=" + query)
                                    : ("https://play.google.com/store/search?q=" + Uri.encode(query));
                            Intent b = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            b.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(b);
                        } catch (Exception e2) {
                            Toast.makeText(MainActivity.this, "Play Store nahi mila", Toast.LENGTH_SHORT).show();
                        }
                    }
                }
            });
            return isPkg ? ("PLAY_STORE: " + query + " ka page khul gaya - Install dabao")
                        : ("PLAY_STORE: '" + query + "' search khul gayi - app chuno, Install dabao");
        }

        @JavascriptInterface
        public String askPerms() {
            askPerm(null);
            String call = hasPerm("android.permission.CALL_PHONE") ? "OK" : "NAHI";
            String sms = hasPerm("android.permission.SEND_SMS") ? "OK" : "NAHI";
            String mic = hasPerm("android.permission.RECORD_AUDIO") ? "OK" : "NAHI";
            return "Call: " + call + " | SMS: " + sms + " | Mic: " + mic;
        }
    }
}
