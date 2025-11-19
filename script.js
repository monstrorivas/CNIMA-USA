// Initialize all scripts after components are loaded
function initializeScripts() {
    // Smooth scrolling for anchor links (using event delegation)
    document.addEventListener('click', function(e) {
        const anchor = e.target.closest('a[href^="#"]');
        if (anchor) {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }
    });

    // Form submission handling
    const form = document.querySelector('form[name="registration"]');
    const formSuccess = document.getElementById('form-success');

    if (form) {
        form.addEventListener('submit', function(e) {
            // Let Netlify handle the form submission
            // We'll show success message after a brief delay
            setTimeout(() => {
                form.classList.add('hidden');
                if (formSuccess) {
                    formSuccess.classList.remove('hidden');
                    formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        });
    }

    // Add active state to navigation links on scroll
    function updateActiveNav() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-links a');
        
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (window.pageYOffset >= sectionTop - 200) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    }

    window.addEventListener('scroll', updateActiveNav);
    updateActiveNav(); // Initial check

    // Format phone number input
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 0) {
                if (value.length <= 3) {
                    value = `(${value}`;
                } else if (value.length <= 6) {
                    value = `(${value.slice(0, 3)}) ${value.slice(3)}`;
                } else {
                    value = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6, 10)}`;
                }
            }
            e.target.value = value;
        });
    }

    // Format date of birth input
    const dobInput = document.getElementById('dateOfBirth');
    if (dobInput) {
        dobInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = `${value.slice(0, 2)}/${value.slice(2)}`;
            }
            if (value.length >= 5) {
                value = `${value.slice(0, 5)}/${value.slice(5, 9)}`;
            }
            e.target.value = value;
        });
    }
}

// If components are already loaded (fallback for direct access)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        // Wait a bit for components to load
        setTimeout(initializeScripts, 100);
    });
} else {
    // DOM already loaded, wait for components
    setTimeout(initializeScripts, 100);
}

