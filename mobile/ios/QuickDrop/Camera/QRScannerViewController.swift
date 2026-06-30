import UIKit
import AVFoundation
import CoreImage

/// 二维码扫描视图控制器
///
/// 使用 AVFoundation 实现实时扫码。
/// 扫码成功后关闭页面，通过回调返回结果。
///
/// 对应 Android 的 QRScannerActivity (CameraX + ML Kit)
final class QRScannerViewController: UIViewController {

    // MARK: - Properties

    /// 扫描结果回调
    var onScanResult: ((String) -> Void)?

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let scanQueue = DispatchQueue(label: "com.quickdrop.qrscanner", qos: .userInitiated)

    // MARK: - UI Components

    private lazy var closeButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("✕", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 28, weight: .medium)
        button.tintColor = .white
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(dismissScanner), for: .touchUpInside)
        return button
    }()

    private lazy var hintLabel: UILabel = {
        let label = UILabel()
        label.text = "将二维码对准框内"
        label.textColor = .white
        label.font = .systemFont(ofSize: 16)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private lazy var scanFrameView: UIView = {
        let view = UIView()
        view.layer.borderColor = UIColor.white.cgColor
        view.layer.borderWidth = 2
        view.layer.cornerRadius = 12
        view.backgroundColor = .clear
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
        setupCamera()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startScanning()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopScanning()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.addSubview(scanFrameView)
        view.addSubview(hintLabel)
        view.addSubview(closeButton)

        NSLayoutConstraint.activate([
            // 扫描框（正方形，屏幕宽度的 70%）
            scanFrameView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            scanFrameView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            scanFrameView.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.7),
            scanFrameView.heightAnchor.constraint(equalTo: scanFrameView.widthAnchor),

            // 提示文字
            hintLabel.topAnchor.constraint(equalTo: scanFrameView.bottomAnchor, constant: 24),
            hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

            // 关闭按钮
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            closeButton.widthAnchor.constraint(equalToConstant: 44),
            closeButton.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    // MARK: - Camera Setup

    private func setupCamera() {
        // 检查相机权限
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureCaptureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureCaptureSession()
                    } else {
                        self?.showPermissionDenied()
                    }
                }
            }
        case .denied, .restricted:
            showPermissionDenied()
        @unknown default:
            showPermissionDenied()
        }
    }

    private func configureCaptureSession() {
        let session = AVCaptureSession()
        session.sessionPreset = .hd1280x720

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device) else {
            showCameraError()
            return
        }

        guard session.canAddInput(input) else {
            showCameraError()
            return
        }
        session.addInput(input)

        // 视频数据输出（用于扫码分析）
        let output = AVCaptureVideoDataOutput()
        output.setSampleBufferDelegate(self, queue: scanQueue)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]

        guard session.canAddOutput(output) else {
            showCameraError()
            return
        }
        session.addOutput(output)

        // 预览层
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.insertSublayer(preview, at: 0)
        self.previewLayer = preview

        self.captureSession = session

        // 添加半透明遮罩（扫描框外区域变暗）
        addOverlayMask()
    }

    /// 半透明遮罩，突出扫描框区域
    private func addOverlayMask() {
        let overlay = UIView(frame: view.bounds)
        overlay.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(overlay, at: 1)

        // 在遮罩上挖出扫描框区域
        let maskLayer = CAShapeLayer()
        let path = UIBezierPath(rect: overlay.bounds)
        let scanFrame = CGRect(
            x: view.bounds.midX - view.bounds.width * 0.35,
            y: view.bounds.midY - view.bounds.width * 0.35,
            width: view.bounds.width * 0.7,
            height: view.bounds.width * 0.7
        )
        path.append(UIBezierPath(roundedRect: scanFrame, cornerRadius: 12))
        maskLayer.path = path.cgPath
        maskLayer.fillRule = .evenOdd
        overlay.layer.mask = maskLayer
    }

    // MARK: - Scanning Control

    private func startScanning() {
        scanQueue.async { [weak self] in
            self?.captureSession?.startRunning()
        }
    }

    private func stopScanning() {
        scanQueue.async { [weak self] in
            self?.captureSession?.stopRunning()
        }
    }

    // MARK: - Actions

    @objc private func dismissScanner() {
        dismiss(animated: true)
    }

    // MARK: - Error Handling

    private func showPermissionDenied() {
        let alert = UIAlertController(
            title: "需要相机权限",
            message: "请在设置中允许 QuickDrop 访问相机以扫描二维码",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
            self?.dismissScanner()
        })
        alert.addAction(UIAlertAction(title: "去设置", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        })
        present(alert, animated: true)
    }

    private func showCameraError() {
        let alert = UIAlertController(
            title: "相机不可用",
            message: "无法启动相机",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak self] _ in
            self?.dismissScanner()
        })
        present(alert, animated: true)
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension QRScannerViewController: AVCaptureVideoDataOutputSampleBufferDelegate {

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }

        // 使用 CIDetector 检测二维码
        guard let detector = CIDetector(
            ofType: CIDetectorTypeQRCode,
            context: context,
            options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
        ) else { return }

        let features = detector.features(in: ciImage)
        for feature in features {
            guard let qrFeature = feature as? CIQRCodeFeature,
                  let qrData = qrFeature.messageString else { continue }

            // 验证是否是 QuickDrop 配对码
            guard qrData.contains("quickdrop_pairing") else { continue }

            // 扫码成功，停止扫描并回调
            DispatchQueue.main.async { [weak self] in
                // 触觉反馈
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.success)

                self?.onScanResult?(qrData)
                self?.dismissScanner()
            }
            return
        }
    }
}
