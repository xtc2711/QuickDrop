package com.quickdrop.app.camera

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Size
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.quickdrop.app.R
import com.quickdrop.app.QuickDropApplication
import java.util.concurrent.Executors

/**
 * 二维码扫描 Activity
 *
 * 使用 CameraX + ML Kit Barcode Scanning 实现实时扫码
 * 扫码成功后关闭页面，通过 JSBridge 回传结果
 */
class QRScannerActivity : ComponentActivity() {

    private lateinit var previewView: PreviewView
    private val analysisExecutor = Executors.newSingleThreadExecutor()

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                startCamera()
            } else {
                Toast.makeText(
                    this,
                    getString(R.string.permission_camera_required),
                    Toast.LENGTH_LONG
                ).show()
                finish()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_qr_scanner)

        previewView = findViewById(R.id.preview_view)

        // 检查相机权限
        when {
            ContextCompat.checkSelfPermission(
                this, Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED -> {
                startCamera()
            }
            else -> {
                requestPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)

        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            // Preview
            val preview = Preview.Builder()
                .build()
                .also { it.setSurfaceProvider(previewView.surfaceProvider) }

            // Image Analysis — 扫码
            val imageAnalysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(1280, 720))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            imageAnalysis.setAnalyzer(analysisExecutor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage != null) {
                    val inputImage = InputImage.fromMediaImage(
                        mediaImage, imageProxy.imageInfo.rotationDegrees
                    )

                    val scanner = BarcodeScanning.getClient()
                    scanner.process(inputImage)
                        .addOnSuccessListener { barcodes ->
                            for (barcode in barcodes) {
                                if (barcode.valueType == Barcode.TYPE_TEXT) {
                                    val qrData = barcode.displayValue ?: continue

                                    // 验证是否是 QuickDrop 配对码
                                    if (qrData.contains("quickdrop_pairing")) {
                                        // 回传给 WebView（通过 Application 获取 JSBridge）
                                        val app = application as QuickDropApplication
                                        app.jsBridge?.onQRCodeScanned(qrData)

                                        // 关闭扫码页面
                                        runOnUiThread { finish() }
                                        return@addOnSuccessListener
                                    }
                                }
                            }
                        }
                        .addOnCompleteListener {
                            imageProxy.close()
                        }
                } else {
                    imageProxy.close()
                }
            }

            // 选择后置摄像头
            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this, cameraSelector, preview, imageAnalysis
                )
            } catch (e: Exception) {
                Toast.makeText(this, "无法启动相机: ${e.message}", Toast.LENGTH_SHORT).show()
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onDestroy() {
        super.onDestroy()
        analysisExecutor.shutdown()
    }
}
