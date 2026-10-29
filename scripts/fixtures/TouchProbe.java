package dev.adbvault.touchprobe;
import android.app.Activity;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import org.json.JSONObject;
import org.json.JSONArray;
public class TouchProbe extends Activity {
  public void onCreate(Bundle state) { super.onCreate(state); getWindow().getDecorView().setSystemUiVisibility(5894); setContentView(new View(this){
    protected void onDraw(Canvas canvas){ canvas.drawColor(Color.rgb(18,32,40)); Paint p=new Paint(); p.setColor(Color.rgb(100,230,190)); p.setTextSize(32); canvas.drawText("ADB Vault · Touch control test",40,60,p); p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(3);canvas.drawCircle(150,400,70,p);canvas.drawCircle(650,400,40,p); }
    public boolean onTouchEvent(MotionEvent e) {
      try { JSONArray points=new JSONArray(); for(int i=0;i<e.getPointerCount();i++) points.put(new JSONObject().put("id",e.getPointerId(i)).put("x",e.getX(i)).put("y",e.getY(i)));
        android.util.Log.i("VaultTouchProbe",new JSONObject().put("action",e.getActionMasked()).put("index",e.getActionIndex()).put("displayId",getDisplay().getDisplayId()).put("points",points).toString()); } catch(Exception ignored){}
      return true;
    }
  }); }
}
