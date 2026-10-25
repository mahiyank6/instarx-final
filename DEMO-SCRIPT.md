# InstaRX: 60% Implementation Demo Script

Wednesday, 14 October 2026. Planned for about 10 minutes plus questions.

**Assumptions** (correct these if your slot is different): about 10 minutes, a laptop running the site, your phone as a second screen, and one teammate to help.

---

## 1. Setup before you walk in (30 minutes early)

| # | Task | Why |
|---|---|---|
| 1 | Start the server with `python server/app.py` | Nothing works without it |
| 2 | Open **two separate browsers**: Chrome for the customer, an Edge or Chrome Incognito window for the chemist | One browser can only be logged in as one person at a time |
| 3 | Log in as the chemist and switch the shop **Online** | Offline chemists receive nothing |
| 4 | Make sure the chemist account has a **shop location** (create a fresh chemist account and tap "Use my location" at signup) | Customers who have set a location only reach chemists that have one |
| 5 | Log in as the customer and set the delivery address once | It's needed for matching and payment |
| 6 | Keep a clear photo of a sample prescription on the laptop | You'll upload it live |
| 7 | Put `http://<laptop-IP>:5000/app.html` open on your phone (same WiFi) | Shows the phone app |
| 8 | Record a 2-minute screen video of the full flow the night before | Backup if WiFi or the laptop fails |

Arrange the screen with the **customer window on the left** and the **chemist window on the right**.

---

## 2. Timing

| Time | Section | Goal |
|---|---|---|
| 0:00 to 1:00 | Problem and idea | Why InstaRX exists |
| 1:00 to 1:45 | How it is built | Show it is real software |
| 1:45 to 4:00 | Demo 1: normal order | The core flow works |
| 4:00 to 7:00 | Demo 2: prescription chat | The strongest feature |
| 7:00 to 8:00 | Security and live database | Shows it is properly built |
| 8:00 to 9:00 | Phone app | Covers the second deliverable |
| 9:00 to 10:00 | Progress and next steps | Justify the 60% |

---

## 3. The script

**SAY** is what you speak. **DO** is what you click.

### Part 1: Problem and idea (1 minute)

**SAY:**
"Good morning. Our project is InstaRX, a 10-minute medicine delivery platform.
Today, apps like 1mg and PharmEasy deliver from big central warehouses. The local chemist in our own area, who is closer and faster, gets no online presence at all.
InstaRX puts those local chemists online. When a customer orders, the nearest chemist receives it, packs it and delivers it.
So the customer gets medicine faster, and the local shop gets business it was losing."

### Part 2: How it is built (45 seconds)

**SAY:**
"The website is built with HTML, CSS and JavaScript for the screens, and Python with Flask for the server.
The server stores users, orders and prescriptions in a database file.
There are two kinds of users: customers who order, and chemists who fulfil orders. Each one sees a different screen."

### Part 3, Demo 1: a normal order (about 2 minutes)

| DO (customer window) | SAY |
|---|---|
| Open the homepage, wait for the splash screen | "This is the customer's homepage." |
| Tap a Quick Select chip, for example "Fever & Pain" | "Most people know their symptom, not the medicine name. Quick Select shows the right medicines in one tap." |
| Tap **ADD** on Dolo 650, then press **+** once | "ADD turns into a quantity selector, so you never leave the page." |
| Open the cart | "The cart shows the items, the total and the delivery address." |
| Type part of an address in the address box and pick a suggestion | "The address search corrects spelling mistakes and suggests real places." |
| Proceed to Payment, choose Cash on Delivery, confirm | "Payment is simulated at this stage. A real gateway is planned for the next phase." |

| DO (chemist window) | SAY |
|---|---|
| The order appears under Incoming Order Requests. Click **Accept** | "The nearest online chemist receives the order and accepts it." |
| Mark it Packed, then fill in the driver name and mark it Out for Delivery | "The chemist packs it and hands it to a delivery person." |
| Switch to the customer's tracking page | "The customer sees every step live, with the delivery code they give at the door." |

### Part 4, Demo 2: prescription chat (about 3 minutes, the highlight)

**SAY first:**
"Many medicines need a prescription. Instead of the customer guessing what to order, they simply send the prescription, and the chemist checks what is actually in stock."

| DO | SAY |
|---|---|
| Customer: click **Upload Rx**, then **Send prescription**, choose the photo, send | "The customer sends a photo, like on WhatsApp." |
| Point at the tick marks | "Delivered means the chemist has it." |
| Chemist: the "New prescription" pop-up appears and **View documents** shows a red count | "The chemist is notified immediately." |
| Chemist: click **View document** | "The chemist reads the prescription here." |
| Customer: point at **Seen** and "checking stock" | "The customer can see the chemist is working on it." |
| Chemist: search and add Dolo 650, Pan 40 and Cetirizine. Mark Cetirizine **Out of stock** | "The chemist lists each medicine and marks what is available." |
| Point at the "Customer will see" box, then click **Send reply** | "The message is written automatically, so the chemist doesn't have to type it." |
| Customer: read the message aloud | "Dolo and Pan are available but Cetirizine is out of stock. Would you like to buy the available stock?" |
| Customer: click **Yes, buy available**, then pay | "If the customer says yes, the normal order flow starts, priced by the chemist." |
| Chemist: point at the new order in My Orders | "It goes straight into the chemist's orders, ready to pack." |

**SAY:**
"There are three possible outcomes: everything available, nothing available, or part available. If nothing is available, the customer gets an apology, and the chemist moves on to the next prescription in the queue."

### Part 5: Security and live database (1 minute)

| DO | SAY |
|---|---|
| Open the login page, show the eye button on the password field | "Passwords can be shown while typing." |
| Mention signup | "Every account must verify its email with a 6-digit code before it can log in." |
| Say it, don't demo it | "After 5 wrong passwords, the account locks for 15 minutes. Passwords are stored encrypted, so nobody can read them, not even us." |
| Open `/admin.html` | "This is our live database view. It shows every user and every order, and refreshes every 5 seconds." |

### Part 6: Phone app (1 minute)

| DO | SAY |
|---|---|
| Show the phone | "We also built a phone version. It opens in the browser and can be installed like an app." |
| Scroll, tap ADD, open the cart | "Bigger buttons, a bottom menu and a floating cart bar make it easy to use with one hand." |

### Part 7: Progress and next steps (1 minute)

**SAY:**
"To summarise, the complete loop is working: customer, chemist, prescription and delivery. That is our 60%.
The remaining 40% is real payments, live GPS tracking, reading prescriptions automatically, checking chemist licences, and putting the site online permanently."

| Done (60%) | Remaining (40%) |
|---|---|
| Customer website and phone app | Real payment gateway (Razorpay or UPI) |
| Chemist dashboard and order flow | Live GPS tracking of the delivery person |
| Prescription chat with stock check | Reading prescription text automatically |
| Email verification, account lock, encrypted passwords | Drug licence verification for chemists |
| Quick Select, address search, live database | Real email sending and permanent hosting |
| 64-product catalogue across 8 categories | Testing on more devices, final report |

**Close:** "Thank you. We're happy to take questions."

---

## 4. Explaining it to the guide in simple words

| If the guide asks about | Simple explanation |
|---|---|
| Frontend | "What the user sees and clicks: HTML for structure, CSS for design, JavaScript for actions." |
| Backend (Flask) | "The server takes requests, like 'place this order', checks them and saves the result." |
| Database | "A file on the server holding users, orders and prescriptions. It stays after a restart." |
| API | "The way the screens talk to the server. For example, the cart page asks the server for the cart." |
| Nearest chemist | "We use the latitude and longitude of the customer and every shop to calculate distance, then notify the closest ones." |
| Email verification | "A 6-digit code proves the email belongs to the user, like a bank OTP." |
| Password storage | "Passwords are converted into a code that can't be reversed. At login we convert the typed password again and compare the two." |
| Live updates | "The page asks the server for changes every 4 seconds, so new messages appear without refreshing." |
| Prescription privacy | "Only the customer who sent the file and the chemist handling it can open it." |

---

## 5. Likely questions

| Question | Answer |
|---|---|
| How do you keep the 10-minute promise? | "The order goes to the nearest chemist, not a far-away warehouse." |
| What if two chemists open the same prescription? | "The first one gets it, and it disappears for the others. If they don't reply within 10 minutes, it is freed again." |
| Can a chemist change prices? | "No. Prices always come from our catalogue, never from the chemist's screen." |
| Why was the verification code shown on screen? | "Email sending isn't connected yet, so in test mode the code shows on screen. The real email setup is ready to connect." |
| Is the payment real? | "No, it is simulated. No money moves. A real gateway is in the remaining 40%." |
| Why a file and not MySQL? | "A file was simpler for the prototype. Moving to PostgreSQL or MySQL is planned when we scale." |
| How is a chemist verified? | "Currently by email. A drug licence check is planned." |

The database question is the most likely one. Say it confidently, without apologising.

---

## 6. What not to show

| Avoid | Reason |
|---|---|
| Code, the terminal, or `data.json` | It uses up time and invites nitpicking |
| The Contact Us card, unless the real names are filled in | It still has placeholders |
| Clicking features you haven't rehearsed | Surprise errors cost marks |
| Calling payments or GPS "real" | They are simulated. Being upfront reads as honest. |
| Words like "just", "sorry", "it's a bit buggy" | Say "in the next phase" instead |

---

## 7. If something breaks

| Problem | What to do |
|---|---|
| A page doesn't load | Check the server is still running. Restart it with `python server/app.py` |
| The chemist doesn't receive an order or prescription | Check the shop is Online and has a location |
| Both windows show the same user | You used the same browser. Use Incognito for the chemist |
| WiFi drops or the phone can't connect | Show the phone app on the laptop instead, at `/app.html` |
| Anything else | Play the backup video and keep talking |
