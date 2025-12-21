import os
import sys
import subprocess

# Add the current directory to sys.path to allow imports from lib
# This ensures it works when run from project root as `python src/preview_template.py`
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from lib.pdf_converter import convert_html_to_pdf

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(base_dir)
    
    template_dir = os.path.join(base_dir, 'template')
    input_html = os.path.join(template_dir, 'text.html')
    output_dir = os.path.join(project_root, 'output')
    output_pdf = os.path.join(output_dir, 'preview_template.pdf')

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    if not os.path.exists(input_html):
        print(f"Error: Template file not found at {input_html}")
        return

    print(f"Converting {input_html} to PDF...")
    
    # Convert
    # resource_dir is set to template_dir so it can find style.css
    convert_html_to_pdf(input_html, output_pdf, template_dir)

    # Open with default viewer (likely Adobe Reader on Windows)
    if os.path.exists(output_pdf):
        print(f"Opening {output_pdf} with default viewer...")
        try:
            if sys.platform == 'win32':
                os.startfile(output_pdf)
            elif sys.platform == 'darwin':
                subprocess.run(['open', output_pdf], check=True)
            else:
                subprocess.run(['xdg-open', output_pdf], check=True)
        except Exception as e:
            print(f"Failed to open PDF: {e}")
            print("Please open it manually.")

if __name__ == '__main__':
    main()
