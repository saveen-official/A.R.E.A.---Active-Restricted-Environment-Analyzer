import serial
import tkinter as tk

# --- Configuration ---
PORT = '/dev/ttyACM0'  # Change this to your exact ESP32-S3 port
BAUD = 115200

def read_serial():
    try:
        if ser.in_waiting > 0:
            # Read the incoming data, decode it, and strip extra whitespace
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                # Insert the text into the GUI and auto-scroll to the bottom
                text_area.insert(tk.END, line + '\n')
                text_area.see(tk.END)
    except Exception as e:
        pass
    
    # Schedule the function to run again in 50 milliseconds
    root.after(50, read_serial)

try:
    # Open the serial connection
    ser = serial.Serial(PORT, BAUD, timeout=0.1)
    
    # Build the GUI Window
    root = tk.Tk()
    root.title("Sentinel System - Live Telemetry")
    root.geometry("600x500")
    root.configure(bg="#0a0a0a")
    
    # Configure a terminal-style text box
    text_area = tk.Text(root, bg="#0a0a0a", fg="#00ffcc", font=("Consolas", 14, "bold"), wrap="word")
    text_area.pack(expand=True, fill="both", padx=15, pady=15)
    
    text_area.insert(tk.END, f"INITIALIZING LOCAL LINK ON {PORT}...\n")
    text_area.insert(tk.END, "WAITING FOR HARDWARE TELEMETRY...\n\n")
    
    # Start the reading loop and launch the window
    root.after(100, read_serial)
    root.mainloop()
    
except serial.SerialException:
    print(f"\n[ERROR] Could not connect to {PORT}.")
    print("1. Is the ESP32-S3 plugged in?")
    print("2. Is the Arduino IDE Serial Monitor closed? (Only one program can read the port at a time!)\n")