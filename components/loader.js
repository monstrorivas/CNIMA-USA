// Component Loader
// Loads HTML components and injects them into the page

async function loadComponent(componentName, targetElement) {
    try {
        // Add cache-busting parameter for development
        const cacheBuster = `?t=${Date.now()}`;
        const response = await fetch(`components/${componentName}.html${cacheBuster}`, {
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`Failed to load ${componentName}`);
        }
        const html = await response.text();
        // Replace the container div with the actual component content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html.trim();
        
        // Extract and execute any scripts
        const scripts = tempDiv.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            if (oldScript.src) {
                newScript.src = oldScript.src;
            } else {
                newScript.textContent = oldScript.textContent;
            }
            oldScript.remove();
            // Execute script after DOM is updated
            setTimeout(() => {
                document.body.appendChild(newScript);
            }, 10);
        });
        
        const componentContent = tempDiv.firstElementChild;
        if (componentContent) {
            targetElement.replaceWith(componentContent);
        } else {
            targetElement.innerHTML = html;
        }
    } catch (error) {
        console.error(`Error loading component ${componentName}:`, error);
        targetElement.innerHTML = `<p>Error loading ${componentName} component.</p>`;
    }
}

// Load all components when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    const components = [
        { name: 'nav', target: 'nav-container' },
        { name: 'hero', target: 'hero-container' },
        { name: 'about', target: 'about-container' },
        { name: 'teachers', target: 'teachers-container' },
        { name: 'workshop', target: 'workshop-container' },
        { name: 'register', target: 'register-container' },
        { name: 'contact', target: 'contact-container' },
        { name: 'footer', target: 'footer-container' }
    ];

    // Load all components in parallel
    await Promise.all(
        components.map(({ name, target }) => {
            const element = document.getElementById(target);
            if (element) {
                return loadComponent(name, element);
            }
        })
    );

    // Initialize scripts after components are loaded
    // Use setTimeout to ensure DOM is fully updated
    setTimeout(() => {
        if (typeof initializeScripts === 'function') {
            initializeScripts();
        }
    }, 50);
});

