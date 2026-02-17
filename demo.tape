# ampcode-connector demo
# Run: vhs demo.tape

Output demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 500
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set CursorBlink false

# Step 1: Setup
Type "bunx ampcode-connector setup"
Enter
Sleep 3s

# Step 2: Login
Type "bunx ampcode-connector login"
Enter
Sleep 4s

# Step 3: Start proxy
Type "bunx ampcode-connector"
Enter
Sleep 3s
