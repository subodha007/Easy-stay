// ─── Tax Switch (only runs on pages that have the element) ────────────────────
const taxSwitch = document.getElementById("switchCheckReverse");

if (taxSwitch) {
    taxSwitch.addEventListener("click", () => {
        const tax_info = document.getElementsByClassName("tax-info");
        for (let info of tax_info) {
            if (info.style.display !== "inline") {
                info.style.display = "inline";
            } else {
                info.style.display = "none";
            }
        }
    });
}


// ─── Bootstrap Form Validation (only applies to forms with .needs-validation) ──
(() => {
    'use strict';

    const forms = document.querySelectorAll('.needs-validation');

    if (forms.length === 0) return; // no validation forms on this page

    Array.from(forms).forEach(form => {
        form.addEventListener('submit', event => {
            if (!form.checkValidity()) {
                event.preventDefault();
                event.stopPropagation();
            }
            form.classList.add('was-validated');
        }, false);
    });
})();