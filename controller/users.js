const User = require("../models/user");

module.exports.renderSignup = (req, res) => {
    res.render("users/signup");
};

module.exports.userSignup = async (req, res, next) => {
    try {
        let { username, email, password } = req.body;

        // Basic validation before hitting the DB
        if (!username || !email || !password) {
            req.flash("error", "All fields are required.");
            return res.redirect("/signup");
        }

        const newUser = new User({ email, username });
        const regUser = await User.register(newUser, password);

        req.login(regUser, (err) => {
            if (err) {
                return next(err);
            }
            req.flash("success", "Welcome to StayNest! 🎉");
            res.redirect("/listings");
        });

    } catch (err) {
        // passport-local-mongoose gives meaningful errors — show them to the user
        let message = "Something went wrong. Please try again.";
        if (err.name === "UserExistsError") {
            message = "Username already taken. Please choose a different username.";
        } else if (err.name === "MissingPasswordError") {
            message = "Password is required.";
        } else if (err.name === "MissingUsernameError") {
            message = "Username is required.";
        } else if (err.message) {
            message = err.message;
        }
        req.flash("error", message);
        res.redirect("/signup");
    }
};

module.exports.renderLogin = (req, res) => {
    res.render("users/login");
};

module.exports.login = async (req, res) => {
    req.flash("success", `Welcome back, ${req.user.username}! 👋`);
    let redirectUrl = res.locals.redirectUrl || "/listings";
    res.redirect(redirectUrl);
};

module.exports.logout = (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.flash("success", "Logged out successfully. See you soon!");
        res.redirect("/");
    });
};