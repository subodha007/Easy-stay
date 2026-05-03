if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

// ─── Crash Guards ─────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    const isSafe = err.name?.startsWith('Mongo') ||
        err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' ||
        err.message?.includes('SSL') || err.message?.includes('tlsv1') ||
        err.message?.includes('ResetPool') || err.message?.includes('whitelist');
    if (isSafe) {
        console.warn('⚠️  Non-fatal DB/network error:', err.message);
    } else {
        console.error('💀 Fatal error:', err.stack);
        process.exit(1);
    }
});

// ─── Dependencies ─────────────────────────────────────────────────────────────
const express        = require("express");
const mongoose       = require("mongoose");
const path           = require("path");
const methodOverride = require("method-override");
const ejsMate        = require("ejs-mate");
const session        = require("express-session");
const MongoStore     = require('connect-mongo');
const flash          = require("connect-flash");
const passport       = require("passport");
const LocalStrategy  = require("passport-local");
const multer         = require('multer');
const wrapAsync      = require("./utils/wrapAsync.js");
const ExpressError   = require("./utils/ExpressError.js");
const { listingSchema } = require("./schema.js");
const User           = require("./models/user.js");
const { isLoggedIn, isOwner, isReviewAuthor } = require("./middleware.js");
const userRoute          = require("./routes/user.js");
const listingController  = require("./controller/listings.js");
const reviewController   = require("./controller/reviews.js");
const { storage }        = require("./cloudConfig.js");

const upload = multer({ storage });
const app    = express();

// ─── View Engine ──────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));
app.engine('ejs', ejsMate);

// Safe template defaults
app.use((req, res, next) => {
    res.locals.success  = [];
    res.locals.error    = [];
    res.locals.currUser = null;
    next();
});

// ─── DB Connection ────────────────────────────────────────────────────────────
const dbUrl = process.env.ATLASDB_URL;

const mongoOptions = {
    tls: true,
    tlsAllowInvalidCertificates: true,
    family: 4,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    maxPoolSize: 10,
};

// clientPromise lets MongoStore SHARE mongoose's connection (no separate SSL handshake)
const clientPromise = (async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            await mongoose.connect(dbUrl, mongoOptions);
            console.log("✅ Database connected successfully");
            return mongoose.connection.getClient();
        } catch (err) {
            console.error(`❌ DB attempt ${attempt}/5: ${err.message}`);
            if (attempt < 5) await new Promise(r => setTimeout(r, 3000));
        }
    }
    console.warn("⚠️  DB unavailable after retries — app continues without DB.");
    throw new Error("MongoDB unreachable");
})();

// Prevent unhandled rejection if DB stays unreachable
clientPromise.catch(() => {});

mongoose.connection.on("disconnected", () => console.warn("⚠️  MongoDB disconnected."));
mongoose.connection.on("reconnected",  () => console.log("✅  MongoDB reconnected."));
mongoose.connection.on("error",        (err) => console.error("❌ Mongoose error:", err.message));

// ─── Session Store (shares mongoose client — fixes SSL crash) ─────────────────
const store = MongoStore.create({
    clientPromise,
    dbName: "staynest",
    crypto: { secret: process.env.SECRET },
    touchAfter: 24 * 3600,
});
store.on("error", (err) => console.error("❌ Session store error:", err.message));

// ─── Session ──────────────────────────────────────────────────────────────────
app.use(session({
    store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true },
}));

// ─── Flash ────────────────────────────────────────────────────────────────────
app.use(flash());

// ─── Passport ─────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Inject flash messages and logged-in user into all views
app.use((req, res, next) => {
    res.locals.success  = req.flash("success");
    res.locals.error    = req.flash("error");
    res.locals.currUser = req.user || null;
    next();
});

// ─── DB Health Middleware ─────────────────────────────────────────────────────
const requireDB = (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        req.flash("error", "Database is unavailable. Please try again later.");
        return res.redirect("/");
    }
    next();
};

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/", userRoute);  // signup, login, logout

app.get("/privacy", (req, res) => res.render("./listings/privacy.ejs"));
app.get("/terms",   (req, res) => res.render("./listings/terms.ejs"));
app.get("/",        listingController.homeRoute);
app.get("/profile", isLoggedIn, listingController.profileRoute);

// Listings
app.get("/listings",          requireDB, wrapAsync(listingController.index));
app.get("/listings/new",      isLoggedIn, listingController.renderNewForm);
app.get("/listings/:id",      requireDB, wrapAsync(listingController.showRoute));
app.post("/listings",         isLoggedIn, requireDB, upload.single('listing[image]'), wrapAsync(listingController.createRoute));
app.get("/listings/:id/edit", isLoggedIn, requireDB, wrapAsync(listingController.editRoute));
app.put("/listings/:id",      isLoggedIn, isOwner, requireDB, upload.single('listing[image]'), wrapAsync(listingController.updateRoute));
app.delete("/listings/:id",   isLoggedIn, requireDB, wrapAsync(listingController.deleteRoute));

// Reviews
app.post("/listings/:id/review",              isLoggedIn, requireDB, wrapAsync(reviewController.createReview));
app.delete("/listings/:id/reviews/:reviewId", isLoggedIn, isReviewAuthor, requireDB, wrapAsync(reviewController.deleteReview));

// 404
app.all("/{*splat}", (req, res, next) => next(new ExpressError(404, "Page Not Found!")));

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    const { statusCode = 500, message = "Something went wrong!" } = err;
    console.error(`[ERROR ${statusCode}]: ${message}`);
    res.status(statusCode).render("error.ejs", { message });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8085;
app.listen(PORT, () => console.log(`🚀 App listening on port ${PORT}`));
