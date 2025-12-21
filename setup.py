import os
import urllib.request
import zipfile
import subprocess
import shutil
import sys

DRIVER_URL = "https://dl.cssj.jp/release/driver/cti-python-3_0_0.zip"
ZIP_FILENAME = "cti-python-3_0_0.zip"
EXTRACT_DIR = "copper_driver"

def download_driver():
    print(f"Downloading driver from {DRIVER_URL}...")
    try:
        urllib.request.urlretrieve(DRIVER_URL, ZIP_FILENAME)
        print("Download complete.")
    except Exception as e:
        print(f"Failed to download driver: {e}")
        sys.exit(1)

def extract_driver():
    print(f"Extracting {ZIP_FILENAME}...")
    try:
        if os.path.exists(EXTRACT_DIR):
            shutil.rmtree(EXTRACT_DIR)
        
        with zipfile.ZipFile(ZIP_FILENAME, 'r') as zip_ref:
            zip_ref.extractall(EXTRACT_DIR)
        print("Extraction complete.")
    except Exception as e:
        print(f"Failed to extract driver: {e}")
        sys.exit(1)

def install_driver():
    print("Installing driver...")
    # Find the directory containing the 'code' folder which holds the package
    code_dir = None
    for root, dirs, files in os.walk(EXTRACT_DIR):
        if "code" in dirs:
            code_dir = os.path.join(root, "code")
            break
    
    if code_dir:
        print(f"Found code directory in {code_dir}")
        # Create a temporary setup.py
        setup_py_content = """
from setuptools import setup, find_packages

setup(
    name="cti-python",
    version="3.0.0",
    packages=find_packages(),
)
"""
        setup_py_path = os.path.join(code_dir, "setup.py")
        with open(setup_py_path, "w") as f:
            f.write(setup_py_content)
        
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "."], cwd=code_dir)
            print("Installation complete.")
        except subprocess.CalledProcessError as e:
            print(f"Failed to install driver: {e}")
            sys.exit(1)
    else:
        print("'code' directory not found in the extracted files.")
        sys.exit(1)

def cleanup():
    print("Cleaning up...")
    if os.path.exists(ZIP_FILENAME):
        os.remove(ZIP_FILENAME)
    if os.path.exists(EXTRACT_DIR):
        shutil.rmtree(EXTRACT_DIR)
    print("Cleanup complete.")

if __name__ == "__main__":
    download_driver()
    extract_driver()
    install_driver()
    cleanup()
