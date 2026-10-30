# Access codes: one-time setup (about 10 minutes)

**What it does:** each phone or iPad that opens the game must enter an email first. You approve the request on your phone, and the player gets a 6-digit code by email. The code works **once, on one device, for 3 hours**. After that the game locks and needs a new code. A saved game is kept and continues after the new code.

**What it uses:** your own Gmail and a Google Sheet. It's free. Gmail can send about **100 code emails a day**, which is plenty for 10 groups.

---

## Step 1: Create the Google Sheet and script

1. On a computer, go to **sheets.google.com** and create a blank sheet. Name it `DWZ Access`.
2. In the sheet, click **Extensions → Apps Script**.
3. Delete everything in `Code.gs`. Open `server/Code.gs` from this folder, copy all of it and paste it in.
4. Click **+** next to *Files* → **HTML**, name it `Admin` (exactly). Delete what's inside, then paste all of `server/Admin.html`.
5. Click **Save** (the disk icon).

## Step 2: Run setup once

1. At the top, choose the function **setup** and click **Run**.
2. Google asks for permission. Click **Review permissions**, choose your Gmail account, then **Advanced → Go to DWZ Access (unsafe) → Allow**.
   - It shows "unsafe" because this is your own script, not a published app. It asks to manage the sheet and send email as you, which is needed to send codes.
3. A "Requests" tab appears in your sheet.

## Step 3: Publish it

1. Click **Deploy → New deployment**. Click the gear icon and choose **Web app**.
2. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

## Step 4: Send me the URL

Paste the Web app URL to Claude. Claude will:
- switch the lock on in the app and publish it to your GitHub link
- give you your **approval page link**. It is the Web app URL plus your secret admin key. To find the key: in Apps Script, open **Project Settings → Script properties → ADMIN_KEY**.

> Keep the approval link private. Anyone with it can approve players.

---

## On the day (e.g. 40 students, 10 groups)

1. Before the session, open your **approval page** on your phone and keep it open. It refreshes every 5 seconds.
2. Each group opens the app link on one device, enters an email and group name, ticks the consent box and taps **Request code**.
3. On your approval page, tap **Approve & email code** for each request. Use **Approve all waiting** if there are several. Tap **Reject** for anything you don't recognise.
4. The player enters the 6-digit code and starts playing. The app says "Approved!" as soon as you approve.
5. After 3 hours the app locks. To continue, they ask for a new code and their saved game continues.

**If an email doesn't arrive:** ask them to check spam. On the approval page the request shows "Code sent". If needed, they tap **Use a different email** and request again.

## Records and privacy (PDPA)

- Every request is a row in the **DWZ Access** sheet: time, email, group, device, status, and whether they agreed to be contacted later.
- Players must tick that their email is used to send the code and record who played. Being contacted about future events is a **separate, optional** tick. Only follow up with people who ticked it.
- Delete old rows when you no longer need them.

## Good to know

- **How strong is the lock?** It stops normal players from playing without your approval. A technical person could still get around it, because the game files are public on GitHub. Make the Claude backup link private too (Share menu on that page), or it stays an open way in.
- **Change the 3 hours:** in `Code.gs`, change `VALID_HOURS = 3`, save, then **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.
- **Switch the lock off:** tell Claude. The app goes back to open access.
