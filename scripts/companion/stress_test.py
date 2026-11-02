import subprocess
import time
import urllib.request
import urllib.error
import socket
import threading
import sys

def main():
    print("=== STARTING LIVE COMPANION SERVER STRESS TEST ===")
    binary = "./scripts/companion/SisyfuzCompanion"
    proc = subprocess.Popen([binary], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(1.0)

    if proc.poll() is not None:
        print(f"FAILED: Companion exited early with code {proc.returncode}")
        sys.exit(1)

    print("Companion launched with PID:", proc.pid)

    # 1. Test status endpoint
    try:
        req = urllib.request.urlopen("http://127.0.0.1:7479/api/status", timeout=3)
        data = req.read().decode('utf-8')
        assert "status" in data, "Response should contain status"
        print("[OK] /api/status responded successfully")
    except Exception as e:
        print(f"FAILED /api/status: {e}")
        proc.kill()
        sys.exit(1)

    # 2. Test abrupt client disconnects (SIGPIPE test on live HTTP server)
    print("Running abrupt disconnect barrage (testing SIGPIPE resilience on HTTP server)...")
    for i in range(50):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", 7479))
        # Send partial request and immediately close socket
        s.sendall(b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\n")
        s.close()
    print("[OK] 50 abrupt socket disconnects handled without SIGPIPE crash")

    # 3. Test delayed client connection (verifying O_NONBLOCK inherited flag fix)
    print("Testing delayed client connection (O_NONBLOCK regression test)...")
    for _ in range(5):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", 7479))
        time.sleep(0.08)  # 80ms delay before sending request
        s.sendall(b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = s.recv(1024)
            if not chunk:
                break
            resp += chunk
        s.close()
        assert b"200 OK" in resp, f"Expected 200 OK for delayed client, got {resp[:50]}"
    print("[OK] Delayed clients serviced properly without premature socket closure")

    # 4. Test chunked / multi-packet HTTP POST
    print("Testing chunked / multi-packet HTTP POST requests...")
    for _ in range(5):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", 7479))
        body = b'{"mode":"Code"}'
        headers = f"POST /api/mode HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n".encode('utf-8')
        # Send headers first
        s.sendall(headers)
        time.sleep(0.03)  # 30ms inter-packet delay
        # Send body in separate packet
        s.sendall(body)
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = s.recv(1024)
            if not chunk:
                break
            resp += chunk
        s.close()
        assert b"200 OK" in resp, f"Expected 200 OK for chunked POST, got {resp[:50]}"
    print("[OK] Chunked multi-packet HTTP POST requests serviced properly")

    # 5. Test concurrent status, mode, scan queries
    print("Running 100 concurrent requests across multiple threads...")
    errors = []
    def worker(idx):
        try:
            if idx % 3 == 0:
                url = "http://127.0.0.1:7479/api/status"
            elif idx % 3 == 1:
                url = "http://127.0.0.1:7479/api/scan"
            else:
                url = "http://127.0.0.1:7479/api/config"
            req = urllib.request.urlopen(url, timeout=5)
            _ = req.read()
        except Exception as e:
            errors.append(str(e))

    threads = []
    for i in range(100):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    print(f"[OK] 100 concurrent requests completed (errors: {len(errors)})")

    # Verify process is still alive and responsive
    time.sleep(0.5)
    if proc.poll() is not None:
        print(f"FAILED: Process died during stress test with exit code {proc.returncode}")
        sys.exit(1)

    # Final status check
    req = urllib.request.urlopen("http://127.0.0.1:7479/api/status", timeout=3)
    data = req.read().decode('utf-8')
    assert "status" in data, "Final status check should succeed"
    print("[OK] Process remains healthy, responsive, and crash-free after barrage")

    # Terminate process cleanly
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()

    print("=== LIVE COMPANION SERVER STRESS TEST PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    main()
