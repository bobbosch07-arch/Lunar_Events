package de.lunarevents.crew;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // An der Tür geht das Display sonst zwischen zwei Gästen aus. Die
        // WebView kennt die Wake-Lock-Schnittstelle des Browsers nicht, deshalb
        // hier: solange die App vorne ist, bleibt der Bildschirm an.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
