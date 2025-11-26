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
    function checkAndShowSuccess() {
        const form = document.querySelector('form[name="registration"]');
        const formSuccess = document.getElementById('form-success');

        // Check on page load if we're coming back from a successful submission
        // Check both window.location.search (query before hash) and hash (query after hash)
        const urlParams = new URLSearchParams(window.location.search);
        const hash = window.location.hash;
        const hashParams = hash.includes('?') ? new URLSearchParams(hash.split('?')[1]) : null;
        
        const isSuccess = urlParams.get('success') === 'true' || 
                         (hashParams && hashParams.get('success') === 'true');
        
        if (isSuccess && form && formSuccess) {
            console.log('Showing success message');
            form.classList.add('hidden');
            formSuccess.classList.remove('hidden');
            // Wait a bit for scroll to work properly
            setTimeout(() => {
                formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
            return true; // Successfully showed
        }
        return false; // Elements not ready yet
    }
    
    // Check multiple times to ensure component is loaded
    let attempts = 0;
    const maxAttempts = 10;
    const checkInterval = setInterval(() => {
        attempts++;
        if (checkAndShowSuccess() || attempts >= maxAttempts) {
            clearInterval(checkInterval);
        }
    }, 100);
    
    // Also check when hash changes (in case user navigates to #register?success=true)
    window.addEventListener('hashchange', checkAndShowSuccess);
    
    // Let Netlify handle form submission naturally
    // Don't prevent default - let it submit to Netlify

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

