/**
 * CiudadActiva Pro - Version 4.4 (Full Screen Home Selection)
 */

class CiudadActivaApp {
    constructor() {
        this.reports = JSON.parse(localStorage.getItem('ca_reports')) || [];
        this.users = JSON.parse(localStorage.getItem('ca_users')) || [];
        this.user = JSON.parse(localStorage.getItem('ca_user')) || null;
        this.obras = JSON.parse(localStorage.getItem('ca_obras')) || [];
        
        this.device = localStorage.getItem('device') || 'pc';
        document.body.classList.add(this.device);
        if (this.device === 'mobile') document.body.classList.add('mobile-mode');

        if (this.reports.length === 0) this.seedData();
        if (this.obras.length === 0) this.seedObras();
        
        this.map = null;
        this.regMap = null;
        this.chart = null;
        this.markers = [];
        this.obrasMap = null;
        this.obrasMarkers = [];
        this.laRiojaCenter = [-29.4131, -66.8558];
        this.officialPIN = "ACTIVA2026";
        
        // Propiedades de Audio y Multimedia
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioBlob = null;
        this.audioBase64 = null;
        this.timerInterval = null;
        this.seconds = 0;
        
        this.streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png');
        this.satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Esri'
        });

        this.init();
    }

    init() {
        this.detectPageAndInit();
        this.registerSW();
    }

    registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('SW registrado', reg))
                    .catch(err => console.error('Error al registrar SW', err));
            });
        }
    }

    detectPageAndInit() {
        if (document.getElementById('login-container')) {
            this.initLoginPage();
        } else if (document.body.classList.contains('app-layout') && !document.body.classList.contains('admin-theme')) {
            if (!this.user) return window.location.href = "index.html";
            this.initCitizenPage();
        } else if (document.body.classList.contains('admin-theme')) {
            const currentRole = this.user ? (this.user.role || this.user.rol) : null;
            if (!this.user || currentRole !== 'funcionario') return window.location.href = "index.html";
            this.initAdminPage();
        }
    }

    initLoginPage() { 
        console.log("Login Ready"); 
        
        // Auto-detección de dispositivo
        const isMobile = /iPhone|Android|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
        this.setDevice(isMobile ? 'mobile' : 'pc');
    }

    setDevice(type) {
        this.device = type;
        const pcBtn = document.getElementById('device-pc');
        const mobileBtn = document.getElementById('device-mobile');
        
        if (pcBtn && mobileBtn) {
            pcBtn.classList.toggle('active', type === 'pc');
            mobileBtn.classList.toggle('active', type === 'mobile');
        }

        // Aplicar clase al body para previsualización o efecto inmediato
        document.body.classList.remove('pc', 'mobile', 'mobile-mode');
        document.body.classList.add(type);
        if (type === 'mobile') document.body.classList.add('mobile-mode');
    }

    // --- MOBILE UI LOGIC ---
    toggleSheet() {
        const sheet = document.getElementById('bottom-sheet');
        if (sheet) {
            sheet.classList.toggle('open');
            // Si se abre el sheet, rotar el handle o cambiar label
            const label = sheet.querySelector('.sheet-drag-label');
            if (label) {
                label.innerText = sheet.classList.contains('open') ? "Deslizar para cerrar" : "Deslizar para ver más";
            }
        }
    }

    switchSheetTab(tab) {
        document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sheet-view').forEach(v => v.classList.remove('active'));
        
        const targetTab = document.getElementById(`tab-${tab}`);
        const targetView = document.getElementById(`sheet-view-${tab}`);
        
        if (targetTab) targetTab.classList.add('active');
        if (targetView) targetView.classList.add('active');

        // Lógica especial para cargar contenido en la pestaña
        if (tab === 'create') this.prepareMobileCreate();
        if (tab === 'reports') this.renderCitizenList();
    }

    prepareMobileCreate() {
        const desktopForm = document.getElementById('report-form');
        const mobileContainer = document.getElementById('mobile-create-content');
        if (desktopForm && mobileContainer && (mobileContainer.innerHTML === '' || mobileContainer.innerHTML.includes('<!-- empty -->'))) {
            // Clonamos el formulario
            const clone = desktopForm.cloneNode(true);
            clone.id = 'mobile-report-form';
            
            mobileContainer.innerHTML = '';
            mobileContainer.appendChild(clone);
            this.bindMobileFormEvents(clone);
        }
    }

    bindMobileFormEvents(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.tempPos) return this.showToast("Marca el lugar en el mapa", "error");
            
            const photoInput = form.querySelector('#photo');
            let photoBase64 = null;
            if (photoInput && photoInput.files.length > 0) {
                photoBase64 = await this.processImage(photoInput.files[0]);
            }

            const report = {
                id: Date.now(), 
                cat: form.querySelector('#cat').value,
                urgency: form.querySelector('#urgency').value,
                desc: form.querySelector('#desc').value || (this.audioBase64 ? "Reporte por voz" : ""),
                pos: [this.tempPos.lat, this.tempPos.lng],
                estado: "Recibido", 
                name: this.user.name, 
                email: this.user.email,
                fecha: new Date().toLocaleDateString(),
                votos: 0, 
                photo: photoBase64, 
                audio: this.audioBase64,
                area: "Sin asignar"
            };
            this.reports.push(report);
            this.save();
            this.showToast("✅ Reporte enviado con éxito", "success");
            
            form.reset();
            this.borrarAudio();
            this.toggleSheet();
            this.renderMarkers();
            this.renderCitizenList();
            this.mostrar('mapa');
        });

        const photoInput = form.querySelector('#photo');
        if (photoInput) {
            photoInput.addEventListener('change', () => this.previewPhoto(photoInput));
        }
    }

    toggleMobileAudio() {
        if (!this.recording) {
            this.iniciarGrabacion();
        } else {
            this.detenerGrabacion();
            
            // Abrimos el panel de creación automáticamente después de un breve delay
            setTimeout(() => {
                const sheet = document.getElementById('bottom-sheet');
                if (sheet && !sheet.classList.contains('open')) this.toggleSheet();
                this.switchSheetTab('create');
            }, 800);
        }
    }
    initCitizenPage() {
        document.getElementById('user-name').textContent = this.user.name;
        setTimeout(() => this.initMap(), 400);
        setTimeout(() => this.initObrasMap(), 400);
        this.bindCitizenEvents();
        this.renderCitizenList();
        this.renderObrasList();
        this.checkNotifications();

        // En móvil, abrir el sheet un poco para mostrar que existe
        if (this.device === 'mobile') {
            setTimeout(() => {
                const sheet = document.getElementById('bottom-sheet');
                if (sheet) {
                    // El sheet ya está en posición cerrada mostrando el handle y tabs
                    console.log("Modo móvil activo");
                }
            }, 1000);
        }
    }
    initAdminPage() {
        if (!this.user) {
            window.location.href = "index.html";
            return;
        }
        const nameElem = document.getElementById('user-name');
        if (nameElem) nameElem.textContent = this.user.name || "Funcionario";
        
        setTimeout(() => this.initMap(), 400);
        this.renderAdminList();
        this.renderAdminObrasList();
        this.checkNotifications();
    }

    checkNotifications() {
        let notifs = JSON.parse(localStorage.getItem('ca_notifications')) || [];
        const myNotifs = notifs.filter(n => n.user === this.user.name);
        myNotifs.forEach((n, i) => {
            setTimeout(() => this.showToast("🔔 " + n.msg, "success"), i * 3000);
        });
        notifs = notifs.filter(n => n.user !== this.user.name);
        localStorage.setItem('ca_notifications', JSON.stringify(notifs));
    }

    // --- HOME SELECTOR (NEW FLOW) ---
    openHomeSelector() {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('full-map-selector').style.display = 'flex';
        
        if (!this.regMap) {
            this.regMap = L.map('reg-map', { zoomControl: false }).setView(this.laRiojaCenter, 15);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(this.regMap);
            
            this.regMap.on('click', (e) => {
                this.tempHomePos = e.latlng;
                const homeIcon = L.divIcon({
                    html: '<i class="fa-solid fa-house" style="color:#0a66c2; font-size:1.5rem;"></i>',
                    className: 'home-icon-div', iconSize: [40, 40], iconAnchor: [20, 20]
                });
                if (this.homeMarker) this.regMap.removeLayer(this.homeMarker);
                this.homeMarker = L.marker(e.latlng, { icon: homeIcon }).addTo(this.regMap);
            });
        }
        setTimeout(() => this.regMap.invalidateSize(), 400);
    }

    closeHomeSelector() {
        document.getElementById('full-map-selector').style.display = 'none';
        document.getElementById('login-container').style.display = 'flex';
    }

    confirmHomeLocation() {
        if (!this.tempHomePos) return this.showToast("Primero toca tu ubicación en el mapa", "error");
        this.closeHomeSelector();
        document.getElementById('home-status-msg').style.display = 'block';
        this.showToast("Ubicación guardada temporalmente. ¡Regístrate o entra!", "success");
    }

    // --- AUTH ---
    login() {
        const email = document.getElementById('email').value;
        const pass = document.getElementById('pass').value;
        const rol = document.getElementById('rol').value;
        const pin = document.getElementById('pin') ? document.getElementById('pin').value : "";

        if (!email || !pass) return this.showToast("Completa los datos", "error");
        if (rol === 'funcionario' && pin !== this.officialPIN) return this.showToast("PIN Incorrecto", "error");

        let found = this.users.find(u => u.email === email && u.pass === pass);
        const userData = found || { name: email.split('@')[0], email, role: rol, home: this.tempHomePos || null };
        
        this.user = userData;
        localStorage.setItem('ca_user', JSON.stringify(this.user));
        localStorage.setItem('device', this.device);
        window.location.href = (rol === 'funcionario') ? "admin.html" : "app.html";
    }

    register() {
        const email = document.getElementById('email').value;
        const pass = document.getElementById('pass').value;
        const rol = document.getElementById('rol').value;
        if (!email || !pass) return this.showToast("Faltan datos", "error");

        const newUser = { email, pass, rol, name: email.split('@')[0], home: this.tempHomePos || null };
        this.users.push(newUser);
        localStorage.setItem('ca_users', JSON.stringify(this.users));
        this.showToast("Usuario registrado con éxito.", "success");
    }

    // --- MAIN MAP ---
    initMap() {
        const container = document.getElementById('map');
        if (!container) return;
        this.map = L.map('map', { zoomControl: false }).setView(this.laRiojaCenter, 14);
        const baseMaps = { "Calle": this.streetLayer, "Satelital": this.satLayer };
        L.control.layers(baseMaps, null, { position: 'topright' }).addTo(this.map);
        this.streetLayer.addTo(this.map);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        const handleMapClick = (e) => {
            // Permitimos marcar ubicación a cualquier usuario logueado en la app
            if (this.user) {
                this.tempPos = e.latlng;
                if (this.tempMarker) this.map.removeLayer(this.tempMarker);
                this.tempMarker = L.marker(e.latlng).addTo(this.map);
                
                // Actualizar indicador de ubicación en el formulario de reporte
                const locIndicator = document.getElementById('location-indicator');
                const locText = document.getElementById('location-text');
                if (locIndicator && locText) {
                    locIndicator.classList.remove('no-location');
                    locIndicator.classList.add('has-location');
                    locText.innerText = "Ubicación seleccionada correctamente";
                }

                const popupContent = `
                    <div style="text-align:center; padding:5px; min-width: 160px;">
                        <b style="color:var(--primary);"><i class="fa-solid fa-location-dot"></i> Ubicación Seleccionada</b><br>
                        <p style="font-size:0.8rem; color:#666; margin:8px 0;">Inicia tu reporte desde aquí.</p>
                        <button onclick="app.mostrar('reportes')" style="width:100%; padding:10px; background:var(--primary); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; box-shadow:0 4px 10px rgba(230,25,43,0.3);">
                            <i class="fa-solid fa-file-signature"></i> Crear Reporte
                        </button>
                    </div>
                `;
                this.tempMarker.bindPopup(popupContent).openPopup();
            }
        };

        this.map.on('click', handleMapClick);
        this.map.on('contextmenu', handleMapClick);
        
        // Add Satellite toggle button custom control
        const SatelliteControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: (map) => {
                const btn = L.DomUtil.create('button', 'btn-secondary');
                btn.innerHTML = '<i class="fa-solid fa-satellite"></i> Satélite / Calle';
                btn.style.padding = '8px 12px'; btn.style.margin = '10px';
                btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
                btn.onclick = () => {
                    if (this.map.hasLayer(this.streetLayer)) {
                        this.map.removeLayer(this.streetLayer);
                        this.map.addLayer(this.satLayer);
                    } else {
                        this.map.removeLayer(this.satLayer);
                        this.map.addLayer(this.streetLayer);
                    }
                };
                return btn;
            }
        });
        this.map.addControl(new SatelliteControl());

        this.renderMarkers();
        setTimeout(() => this.map.invalidateSize(), 500);
    }

    getCol(r) {
        if (!r) return '#f59e0b';
        const estado = typeof r === 'string' ? r : r.estado;
        if (estado === 'Solucionado') return '#057642';
        if (estado === 'En proceso') return '#0a66c2';
        if (estado === 'En revisión') return '#6366f1';
        if (typeof r === 'object' && r.urgency === 'Alto') return '#d11124';
        return '#f59e0b';
    }

    getReportIcon(r) {
        // Rutas de las imágenes proporcionadas por el usuario
        const icons = {
            grave: 'assets/grave.png',
            intermedio: 'assets/intermedio.png',
            solucionado: 'assets/solucionado.png',
            revision: 'assets/revision.png',
            proceso: 'assets/proceso.png'
        };

        if (r.estado === 'Solucionado') return icons.solucionado;
        if (r.estado === 'En proceso') return icons.proceso;
        if (r.estado === 'En revisión') return icons.revision;
        
        // Si el estado es "Recibido", usamos la urgencia
        if (r.urgency === 'Alto') return icons.grave;
        return icons.intermedio; // Medio o Bajo
    }

    getCatIcon(cat) {
        const icons = {
            'Calles': 'fa-road',
            'Alumbrado': 'fa-lightbulb',
            'Limpieza': 'fa-trash',
            'Tránsito': 'fa-car-side',
            'Seguridad': 'fa-shield-halved',
            'Plazas/Parques': 'fa-tree',
            'Agua/Cloacas': 'fa-droplet'
        };
        return icons[cat] || 'fa-triangle-exclamation';
    }

    renderMarkers() {
        if (!this.map) {
            console.warn("Map not initialized yet");
            return;
        }
        
        console.log("Rendering markers for", this.reports.length, "reports");
        this.markers.forEach(m => this.map.removeLayer(m));
        this.markers = [];

        // Marcador de Casa
        if (this.user && this.user.home) {
            try {
                const houseIcon = L.divIcon({
                    html: '<i class="fa-solid fa-house" style="color:#0a66c2; font-size:1.8rem; filter:drop-shadow(0 0 2px white);"></i>',
                    className: 'home-icon', iconSize: [30, 30], iconAnchor: [15, 15]
                });
                L.marker(this.user.home, { icon: houseIcon }).addTo(this.map).bindPopup("Mi Casa");
            } catch(e) { console.error("Error rendering home marker", e); }
        }

        this.reports.forEach(r => {
            // Validaciones básicas
            if (!r.pos || !Array.isArray(r.pos) || r.pos.length < 2) return;
            
            // Si está solucionado y pasó más de 1 minuto, ocultar
            if (r.estado === 'Solucionado' && r.fechaSolucion && (Date.now() - r.fechaSolucion > 60000)) {
                return;
            }
            
            try {
                const iconUrl = this.getReportIcon(r);
                const col = this.getCol(r);
                const catIcon = this.getCatIcon(r.cat);
                
                // Logo de estado con una insignia (badge) de la categoría en la esquina
                const customIcon = L.divIcon({
                    html: `<div style="position:relative; width:50px; height:50px; display:flex; align-items:center; justify-content:center;">
                             <img src="${iconUrl}" style="width:100%; height:100%; object-fit:contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));" onerror="this.src='https://cdn-icons-png.flaticon.com/512/595/595067.png'">
                             <div style="position:absolute; bottom:0; right:0; background:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.3); border:1.5px solid ${col};">
                                <i class="fa-solid ${catIcon}" style="color:${col}; font-size:0.7rem;"></i>
                             </div>
                           </div>`,
                    className: 'custom-report-icon',
                    iconSize: [50, 50],
                    iconAnchor: [25, 25],
                    popupAnchor: [0, -20]
                });

                const m = L.marker(r.pos, { icon: customIcon }).addTo(this.map);
                
                let popupContent = `
                    <div style="font-family: 'Inter', sans-serif; min-width:200px; padding: 5px;">
                        <div style="background:${col}; color:white; padding:8px; border-radius:5px; margin-bottom:10px; text-align:center; font-weight:bold; text-transform:uppercase;">
                            ${r.cat}
                        </div>
                        <p style="margin:5px 0 10px 0; font-size:0.95rem;"><b>Problema:</b> ${r.desc}</p>
                        <p style="margin:0 0 5px 0; font-size:0.8rem; color:#666;"><i class="fa-solid fa-user"></i> Reportado por: ${r.name}</p>
                `;
                
                if (r.photo) {
                    popupContent += `<img src="${r.photo}" style="width:100%; height:130px; object-fit:cover; margin-top:5px; margin-bottom:5px; border-radius:5px; border:1px solid #ddd;">`;
                }
                
                if (r.estado === 'Solucionado') {
                    popupContent += `<div style="margin-top:10px; width:100%; padding:10px; background:#057642; color:white; border-radius:5px; text-align:center; font-weight:800;">✅ Problema Resuelto</div>`;
                } else if (this.user && (this.user.role === 'ciudadano' || this.user.rol === 'ciudadano') && r.name !== this.user.name) {
                    popupContent += `<button onclick="app.votar(${r.id})" style="margin-top:10px; width:100%; padding:10px; background:var(--primary); color:white; border:none; border-radius:5px; cursor:pointer; font-weight:800; box-shadow:0 4px 10px rgba(230,25,43,0.3);">👍 Confirmar (${r.votos || 0})</button>`;
                } else {
                    popupContent += `<p style="margin:10px 0 0 0; font-size:0.85rem; font-weight:bold; color:var(--primary);">Confirmaciones: ${r.votos || 0}</p>`;
                }
                
                popupContent += `</div>`;
                m.bindPopup(popupContent, { minWidth: 220 });
                m.reportId = r.id;
                this.markers.push(m);
            } catch(err) {
                console.error("Error rendering marker for report", r.id, err);
            }
        });
    }

    // --- OTHER ---
    async processImage(file) {
        if (!file) return null;
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 500;
                    const scaleSize = MAX_WIDTH / img.width;
                    canvas.width = MAX_WIDTH;
                    canvas.height = img.height * scaleSize;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    bindCitizenEvents() {
        const form = document.getElementById('report-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!this.tempPos) return this.showToast("Marca el lugar en el mapa", "error");
                
                const photoInput = document.getElementById('photo');
                let photoBase64 = null;
                if (photoInput && photoInput.files.length > 0) {
                    photoBase64 = await this.processImage(photoInput.files[0]);
                }

                const report = {
                    id: Date.now(), 
                    cat: document.getElementById('cat').value,
                    urgency: document.getElementById('urgency').value,
                    desc: document.getElementById('desc').value || (this.audioBase64 ? "Reporte por voz" : ""),
                    pos: [this.tempPos.lat, this.tempPos.lng],
                    estado: "Recibido", 
                    name: this.user.name, 
                    email: this.user.email,
                    fecha: new Date().toLocaleDateString(),
                    votos: 0, 
                    photo: photoBase64, 
                    audio: this.audioBase64,
                    area: "Sin asignar"
                };
                this.reports.push(report);
                this.save();
                this.showToast("✅ Reporte enviado con éxito", "success");
                
                // Limpiar todo
                form.reset();
                this.borrarAudio();
                const previewImg = document.getElementById('photo-preview-img');
                const placeholder = document.getElementById('photo-placeholder');
                if (previewImg) previewImg.style.display = 'none';
                if (placeholder) placeholder.style.display = 'block';

                if (this.tempMarker) { this.map.removeLayer(this.tempMarker); this.tempMarker = null; }
                this.tempPos = null;
                const locIndicator = document.getElementById('location-indicator');
                const locText = document.getElementById('location-text');
                if (locIndicator && locText) {
                    locIndicator.classList.add('no-location');
                    locIndicator.classList.remove('has-location');
                    locText.innerText = "Tocá el mapa para marcar la ubicación";
                }
                
                this.renderMarkers();
                this.renderCitizenList();
                this.mostrar('mapa');
                
                if (this.device === 'mobile') {
                    const sheet = document.getElementById('bottom-sheet');
                    if (sheet) sheet.classList.remove('open');
                }

                setTimeout(() => {
                    this.map.setView(report.pos, 16);
                    const newMarker = this.markers.find(m => m.reportId === report.id);
                    if (newMarker) newMarker.openPopup();
                }, 300);
            });
        }
    }

    renderCitizenList() {
        const lista = document.getElementById('lista');
        const mobileLista = document.getElementById('mobile-lista-reportes');
        
        let html = '';
        const myReports = this.reports.filter(r => r.email === this.user.email);
        
        if (myReports.length === 0) {
            html = '<p style="text-align:center; color:var(--gray-600); padding:20px;">No has realizado reportes aún.</p>';
        }

        [...myReports].reverse().forEach(r => {
            const statusCol = this.getCol(r);
            const canFeedback = r.estado === 'Solucionado' && !r.feedback;
            
            let feedbackHtml = '';
            if (canFeedback) {
                feedbackHtml = `
                    <div class="feedback-container" id="feedback-${r.id}">
                        <div class="feedback-header">
                            <i class="fa-solid fa-heart-pulse"></i> ¡Ayudanos a mejorar!
                        </div>
                        <div class="stars-rating" id="stars-${r.id}">
                            <button onclick="app.setRating(${r.id}, 1)" class="star-btn">⭐</button>
                            <button onclick="app.setRating(${r.id}, 2)" class="star-btn">⭐</button>
                            <button onclick="app.setRating(${r.id}, 3)" class="star-btn">⭐</button>
                            <button onclick="app.setRating(${r.id}, 4)" class="star-btn">⭐</button>
                            <button onclick="app.setRating(${r.id}, 5)" class="star-btn">⭐</button>
                        </div>
                        <textarea class="feedback-input" id="feedback-msg-${r.id}" placeholder="Escribí un agradecimiento u opinión..."></textarea>
                        <button class="btn-feedback-send" onclick="app.enviarFeedback(${r.id})">Enviar Feedback</button>
                    </div>
                `;
            } else if (r.feedback) {
                feedbackHtml = `
                    <div style="margin-top:10px; font-size:0.8rem; color:#057642; background:#ecfdf5; padding:8px; border-radius:8px;">
                        <b>Mi feedback:</b> ${"⭐".repeat(r.feedback.calificacion)} <br> "${r.feedback.comentario}"
                    </div>
                `;
            }

            let chatHtml = `
                <div class="chat-container" id="chat-container-${r.id}" style="display:none;">
                    <div class="chat-box" id="chat-box-${r.id}">
                        ${(r.mensajes || []).map(m => `
                            <div class="msg-bubble ${m.autor === 'funcionario' ? 'msg-admin' : 'msg-user'}">
                                ${m.texto} <br> <small style="opacity:0.7; font-size:0.6rem;">${m.fecha}</small>
                            </div>
                        `).join('')}
                    </div>
                    <div class="chat-input-group">
                        <input type="text" class="chat-input" id="chat-input-${r.id}" placeholder="Responder...">
                        <button class="btn-chat-send" onclick="app.enviarMensaje(${r.id}, 'ciudadano')"><i class="fa-solid fa-paper-plane"></i></button>
                    </div>
                </div>
                <button onclick="app.toggleChat(${r.id})" style="margin-top:8px; width:100%; padding:8px; background:white; color:var(--gray-600); border:1px solid #ddd; border-radius:8px; font-size:0.75rem; cursor:pointer;">
                    <i class="fa-solid fa-comments"></i> Mensajes (${(r.mensajes || []).length})
                </button>
            `;

            html += `
                <div class="mobile-report-card" style="border-left: 5px solid ${statusCol};">
                    <div onclick="app.verEnMapa(${r.id})" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <b style="font-size:1rem;">${r.cat}</b> <br>
                            <span style="background:${statusCol}; color:white; font-size:0.65rem; padding:2px 8px; border-radius:10px; font-weight:800; text-transform:uppercase;">${r.estado}</span>
                            <small style="color:var(--gray-600); margin-left:8px;">${r.fecha}</small>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="color:#ccc;"></i>
                    </div>
                    <p style="margin:10px 0; font-size:0.9rem; color:var(--gray-600);">${r.desc}</p>
                    ${feedbackHtml}
                    ${chatHtml}
                </div>
            `;
        });

        if (lista) lista.innerHTML = html;
        if (mobileLista) mobileLista.innerHTML = html;
        
        // Actualizar contador de impacto en móvil
        const impactElem = document.getElementById('mobile-resolved-count');
        if (impactElem) {
            const resolved = myReports.filter(r => r.estado === 'Solucionado').length;
            impactElem.innerText = resolved;
        }
    }
    renderAdminList() {
        const lista = document.getElementById('lista-admin');
        if (!lista) return;
        
        let html = '';
        [...this.reports].reverse().forEach(r => {
            const statusCol = this.getCol(r);
            html += `
                <div class="card mini-card" style="border-left: 4px solid ${statusCol}; margin-bottom:15px; padding:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                        <div>
                            <b style="font-size:1.1rem;">${r.cat}</b> <br>
                            <span class="badge" style="background:${statusCol}; color:white;">${r.estado}</span>
                        </div>
                        <button onclick="app.verEnMapa(${r.id})" class="btn-chat-send" style="width:30px; height:30px;"><i class="fa-solid fa-location-dot"></i></button>
                    </div>
                    <p style="font-size:0.9rem; margin-bottom:10px;">${r.desc}</p>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <select onchange="app.cambiarEstado(${r.id}, this.value)" style="flex:1; font-size:0.8rem; padding:5px;">
                            <option ${r.estado === 'Recibido' ? 'selected' : ''}>Recibido</option>
                            <option ${r.estado === 'En proceso' ? 'selected' : ''}>En proceso</option>
                            <option ${r.estado === 'En revisión' ? 'selected' : ''}>En revisión</option>
                            <option ${r.estado === 'Solucionado' ? 'selected' : ''}>Solucionado</option>
                        </select>
                        <select onchange="app.cambiarArea(${r.id}, this.value)" style="flex:1; font-size:0.8rem; padding:5px;">
                            <option value="">Asignar Área</option>
                            <option value="Vialidad" ${r.area === 'Vialidad' ? 'selected' : ''}>Vialidad</option>
                            <option value="Iluminación" ${r.area === 'Iluminación' ? 'selected' : ''}>Iluminación</option>
                            <option value="Higiene Urbana" ${r.area === 'Higiene Urbana' ? 'selected' : ''}>Higiene Urbana</option>
                        </select>
                    </div>
                </div>
            `;
        });
        lista.innerHTML = html;
        this.renderStats();
    }
    verEnMapa(id) {
        const r = this.reports.find(x => x.id == id);
        if (r) {
            if (r.estado === 'Solucionado') {
                return this.showToast("Este reporte está solucionado y ya no figura en el mapa.");
            }
            this.mostrar('mapa');
            setTimeout(() => {
                if (this.map) {
                    this.map.setView(r.pos, 16);
                    const marker = this.markers.find(m => m.reportId === id);
                    if (marker) marker.openPopup();
                }
            }, 300);
        }
    }

    cambiarEstado(id, nuevo) {
        const r = this.reports.find(x => x.id == id);
        if (r) {
            r.estado = nuevo; 
            if (nuevo === 'Solucionado') {
                r.fechaSolucion = Date.now();
                this.showToast("🎉 ¡Reporte Solucionado! El ciudadano podrá dar su feedback.", "success");
            }
            this.save();
            this.renderAdminList(); 
            this.renderMarkers();
        }
    }
    cambiarArea(id, nueva) {
        const r = this.reports.find(x => x.id == id);
        if (r && nueva) {
            r.area = nueva; this.save();
            this.renderAdminList();
            this.showToast("Área asignada correctamente");
        }
    }
    votar(id) {
        const r = this.reports.find(x => x.id == id);
        if (r) {
            r.votos = (r.votos || 0) + 1;
            this.save();
            this.renderMarkers();
            this.showToast("¡Gracias por confirmar este reporte!", "success");
        }
    }
    renderStats() {
        const totalElem = document.getElementById('stat-total');
        if (!totalElem) return;
        
        let pendientes = this.reports.filter(r => r.estado !== 'Solucionado').length;
        totalElem.textContent = pendientes;

        // --- FEEDBACK STATS ---
        const feedbacks = this.reports.filter(r => r && r.feedback);
        const thanks = feedbacks.filter(f => f.feedback && f.feedback.agradecimiento).length;
        const avgStars = feedbacks.length > 0 ? (feedbacks.reduce((acc, curr) => acc + (curr.feedback.calificacion || 0), 0) / feedbacks.length).toFixed(1) : "0.0";
        const percPos = feedbacks.length > 0 ? Math.round((feedbacks.filter(f => f.feedback.calificacion >= 4).length / feedbacks.length) * 100) : 0;

        const starsElem = document.getElementById('feedback-avg-stars');
        const thanksElem = document.getElementById('feedback-total-thanks');
        const percElem = document.getElementById('feedback-perc-pos');

        if (starsElem) starsElem.innerText = `${avgStars} ⭐`;
        if (thanksElem) thanksElem.innerText = thanks;
        if (percElem) percElem.innerText = `${percPos}%`;

        const ctx = document.getElementById('grafico');
        if (!ctx) return;
        
        const counts = {};
        this.reports.forEach(r => {
            counts[r.cat] = (counts[r.cat] || 0) + 1;
        });

        if (this.chart) this.chart.destroy();
        
        if (Object.keys(counts).length > 0 && typeof Chart !== 'undefined') {
            this.chart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(counts),
                    datasets: [{
                        data: Object.values(counts),
                        backgroundColor: ['#e6192b', '#f59e0b', '#0a66c2', '#057642']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    }
    mostrarResoluciones() {
        const modal = document.getElementById('resoluciones-modal');
        const lista = document.getElementById('lista-resoluciones');
        if (!modal || !lista) return;

        if (modal.style.display === 'block') {
            modal.style.display = 'none';
            return;
        }

        modal.style.display = 'block';
        lista.innerHTML = '';
        const resueltos = this.reports.filter(r => r.estado === 'Solucionado');
        
        if (resueltos.length === 0) {
            lista.innerHTML = '<p style="color:var(--gray-600); text-align:center; padding:10px;">No hay casos resueltos aún.</p>';
            return;
        }

        // Mostrar del más reciente al más antiguo
        [...resueltos].reverse().forEach(r => {
            let fechaTexto = r.fechaSolucion ? new Date(r.fechaSolucion).toLocaleString() : r.fecha;
            lista.innerHTML += `
                <div style="border-left:4px solid var(--success); padding:10px 15px; margin-bottom:10px; background:var(--bg); border-radius:0 8px 8px 0;">
                    <b style="color:var(--success); font-size:1.1rem;">${r.cat}</b> <span style="color:var(--gray-600); font-size:0.8rem;">- Área: ${r.area || 'General'}</span><br>
                    <p style="margin:5px 0; font-size:0.95rem;">${r.desc}</p>
                    <small style="color:var(--gray-600);"><i class="fa-solid fa-clock"></i> Resuelto el: ${fechaTexto}</small>
                </div>
            `;
        });
    }
    mostrar(vista) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const target = document.getElementById(vista + "View");
        if (target) target.classList.add('active');
        if (vista === 'mapa' && this.map) setTimeout(() => this.map.invalidateSize(), 200);
        if (vista === 'obras' && this.obrasMap) setTimeout(() => { this.obrasMap.invalidateSize(); this.renderObrasList(); }, 200);
        if (vista === 'adminObras') setTimeout(() => { this.renderAdminObrasList(); }, 200);
        if (vista === 'transporte') setTimeout(() => { this.initTransporteMap(); }, 200);
        if (vista === 'servicios') setTimeout(() => { this.initServiciosMap(); }, 200);
        if (vista === 'emergencias') setTimeout(() => { this.initEmergenciasMap(); }, 200);
    }
    logout() { localStorage.removeItem('ca_user'); window.location.href = "index.html"; }
    save() { localStorage.setItem('ca_reports', JSON.stringify(this.reports)); }

    callEmergency(servicio, numero) {
        this.showToast(`📞 Llamando a ${servicio} (${numero})...`, 'success');
        // En producción: window.location.href = `tel:${numero}`;
    }

    // --- MÓDULO EMERGENCIAS ---
    initEmergenciasMap() {
        const container = document.getElementById('emergencias-map');
        if (!container) return;

        if (!this.emergenciasMap) {
            this.emergenciasMap = L.map('emergencias-map', { zoomControl: false }).setView(this.laRiojaCenter, 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(this.emergenciasMap);
            L.control.zoom({ position: 'bottomright' }).addTo(this.emergenciasMap);
            this.emergenciasCapas = [];
        } else {
            this.emergenciasMap.invalidateSize();
        }

        this.renderEmergencias();
    }

    renderEmergencias() {
        const alertasData = JSON.parse(localStorage.getItem('ca_emergencias')) || this.getSeedEmergencias();
        this.emergenciasData = alertasData;

        // Limpiar mapa
        if (this.emergenciasCapas) {
            this.emergenciasCapas.forEach(c => this.emergenciasMap.removeLayer(c));
        }
        this.emergenciasCapas = [];

        const listaActivas = document.getElementById('emerg-lista-activas');
        const historial = document.getElementById('emerg-historial');
        const banner = document.getElementById('emerg-banner');
        const bannerText = document.getElementById('emerg-banner-text');
        if (!listaActivas) return;

        listaActivas.innerHTML = '';
        historial.innerHTML = '';

        const activas = alertasData.filter(a => a.activa);
        const pasadas = alertasData.filter(a => !a.activa);

        // Mostrar banner si hay alerta crítica activa
        const critica = activas.find(a => a.nivel === 'critica');
        if (critica && banner) {
            banner.style.display = 'flex';
            bannerText.textContent = `⚠️ ALERTA CRÍTICA: ${critica.titulo} — ${critica.recomendacion}`;
        } else if (banner) {
            banner.style.display = 'none';
        }

        const colores = { critica: '#d11124', moderada: '#f59e0b', leve: '#3b82f6' };
        const iconos = {
            incendio: 'fa-fire', inundacion: 'fa-water', sismo: 'fa-house-crack',
            viento: 'fa-wind', granizo: 'fa-snowflake', accidente: 'fa-car-burst', corte: 'fa-bolt'
        };

        activas.forEach(a => {
            const col = colores[a.nivel] || '#6b7280';
            const ico = iconos[a.tipo] || 'fa-triangle-exclamation';

            // Dibujar en el mapa
            const circle = L.circle([a.lat, a.lng], {
                color: col, fillColor: col, fillOpacity: 0.2, radius: a.radio,
                weight: 2
            }).addTo(this.emergenciasMap);

            const markerIcon = L.divIcon({
                html: `<div style="background:${col}; color:white; border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 8px rgba(0,0,0,0.3); border:3px solid white;">
                         <i class="fa-solid ${ico}" style="font-size:1rem;"></i>
                       </div>`,
                className: '', iconSize: [36, 36], iconAnchor: [18, 18]
            });
            const marker = L.marker([a.lat, a.lng], { icon: markerIcon }).addTo(this.emergenciasMap);
            marker.bindPopup(`<b style="color:${col}">${a.titulo}</b><br><small>${a.desc}</small><br><i>Recomendación: ${a.recomendacion}</i>`);

            this.emergenciasCapas.push(circle, marker);

            // Tarjeta en la lista
            listaActivas.innerHTML += `
                <div class="emerg-alerta-card" style="background:linear-gradient(135deg,${col},${col}cc); cursor:pointer;"
                     onclick="app.emergenciasMap && app.emergenciasMap.setView([${a.lat},${a.lng}],15)">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <h4><i class="fa-solid ${ico}"></i> ${a.titulo}</h4>
                        <span class="emerg-alerta-badge">${a.nivel.toUpperCase()}</span>
                    </div>
                    <p>${a.desc}</p>
                    <p style="margin-top:8px; opacity:0.85; font-size:0.8rem;">
                        <i class="fa-solid fa-shield-halved"></i> ${a.recomendacion}
                    </p>
                    <small style="opacity:0.7;">${a.zona} — ${a.hora}</small>
                </div>`;
        });

        if (activas.length === 0) {
            listaActivas.innerHTML = `<div style="text-align:center; color:var(--gray-600); padding:20px;">
                <i class="fa-solid fa-check-circle" style="font-size:2rem; color:var(--success);"></i>
                <p style="margin-top:10px;">Sin alertas activas en este momento.</p>
            </div>`;
        }

        // Historial
        pasadas.forEach(a => {
            const col = colores[a.nivel] || '#6b7280';
            const ico = iconos[a.tipo] || 'fa-triangle-exclamation';
            historial.innerHTML += `
                <div class="emerg-historial-item ${a.nivel}">
                    <i class="fa-solid ${ico}" style="color:${col}; font-size:1.2rem;"></i>
                    <div>
                        <b style="font-size:0.9rem;">${a.titulo}</b>
                        <div style="color:var(--gray-600); font-size:0.78rem;">${a.zona} — ${a.hora}</div>
                    </div>
                    <span class="emerg-alerta-badge" style="background:${col}22; color:${col}; margin-left:auto; font-size:0.7rem; padding:2px 8px; border-radius:10px; font-weight:700;">${a.nivel}</span>
                </div>`;
        });

        if (pasadas.length === 0) {
            historial.innerHTML = `<p style="color:var(--gray-600); text-align:center; font-size:0.85rem;">Sin historial reciente.</p>`;
        }
    }

    getSeedEmergencias() {
        const data = [
            {
                id: 1, activa: true, nivel: 'critica', tipo: 'incendio',
                titulo: 'Incendio Forestal — Zona Norte',
                desc: 'Foco activo de incendio. Vientos del sur dificultan control.',
                recomendacion: 'Evacuar el área. Seguir rutas oficiales de evacuación.',
                zona: 'Sierra de Velasco', hora: 'Hoy 14:30 hs',
                lat: -29.395, lng: -66.858, radio: 800
            },
            {
                id: 2, activa: true, nivel: 'moderada', tipo: 'inundacion',
                titulo: 'Alerta por Lluvias Intensas',
                desc: 'Posibles anegamientos en zonas bajas. Arroyo Tajamar en crecida.',
                recomendacion: 'Evitar cruces de agua. No circular por zonas inundables.',
                zona: 'Barrio Sur', hora: 'Hoy 16:00 hs',
                lat: -29.435, lng: -66.845, radio: 600
            },
            {
                id: 3, activa: true, nivel: 'leve', tipo: 'viento',
                titulo: 'Vientos Moderados a Fuertes',
                desc: 'Vientos de hasta 70 km/h previstos para la tarde.',
                recomendacion: 'Asegurar objetos sueltos. No estacionar bajo árboles.',
                zona: 'Ciudad Capital', hora: 'Hoy 18:00 hs',
                lat: -29.413, lng: -66.856, radio: 1200
            },
            {
                id: 4, activa: false, nivel: 'moderada', tipo: 'corte',
                titulo: 'Corte Masivo de Luz (Resuelto)',
                desc: 'Falla en subestación transformadora. Repuesto a las 08:15.',
                recomendacion: 'Restablecido el servicio.',
                zona: 'Barrio Centro', hora: 'Ayer 06:00 hs',
                lat: -29.413, lng: -66.855, radio: 400
            }
        ];
        localStorage.setItem('ca_emergencias', JSON.stringify(data));
        return data;
    }
    showToast(msg, type = "info") {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const t = document.createElement('div');
        t.className = `toast ${type}`; t.innerText = msg;
        container.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }
    seedData() { this.reports = [{ id: 1, name: "Admin", cat: "Calles", desc: "Bache inicial", pos: [-29.412, -66.856], estado: "Recibido", urgency: "Alto", fecha: "25/4/2026" }]; }

    // --- OBRAS PUBLICAS ---
    seedObras() {
        this.obras = [
            {
                id: 1, nombre: "Pavimentación Av. San Nicolás", tipo: "Vialidad",
                lat: -29.405, lng: -66.860, organismo: "Ministerio de Infraestructura",
                presupuesto: "$ 150.000.000", financiamiento: "Provincial",
                estado: "En Ejecución", avance: 65, fechaInicio: "10/01/2026", fechaFin: "30/08/2026",
                fotos: { antes: "https://images.unsplash.com/photo-1585412727339-54e4bae3bbf9?auto=format&fit=crop&w=500&q=60", actual: "https://images.unsplash.com/photo-1541888081696-6e11894d01b1?auto=format&fit=crop&w=500&q=60" },
                actualizaciones: [ { fecha: "15/03/2026", desc: "Se completó la capa asfáltica en los primeros 2km." } ],
                comentarios: []
            },
            {
                id: 2, nombre: "Nuevo Hospital Sur", tipo: "Salud",
                lat: -29.430, lng: -66.840, organismo: "Ministerio de Salud",
                presupuesto: "$ 850.000.000", financiamiento: "Nacional/Provincial",
                estado: "Planificada", avance: 0, fechaInicio: "01/06/2026", fechaFin: "01/12/2027",
                fotos: { antes: "https://images.unsplash.com/photo-1506484381205-f7945653044d?auto=format&fit=crop&w=500&q=60", actual: "" },
                actualizaciones: [], comentarios: []
            },
            {
                id: 3, nombre: "Remodelación Plaza Principal", tipo: "Infraestructura",
                lat: -29.4131, lng: -66.8558, organismo: "Secretaría de Obras",
                presupuesto: "$ 85.000.000", financiamiento: "Municipal",
                estado: "En Ejecución", avance: 40, fechaInicio: "15/02/2026", fechaFin: "15/07/2026",
                fotos: { antes: "https://images.unsplash.com/photo-1582214343163-95c589a19c63?auto=format&fit=crop&w=500&q=60", actual: "https://images.unsplash.com/photo-1517646287270-a5a9ca602e5c?auto=format&fit=crop&w=500&q=60" },
                actualizaciones: [], comentarios: []
            },
            {
                id: 4, nombre: "Escuela N° 12", tipo: "Educación",
                lat: -29.400, lng: -66.850, organismo: "Ministerio de Educación",
                presupuesto: "$ 300.000.000", financiamiento: "Nacional",
                estado: "Finalizada", avance: 100, fechaInicio: "10/05/2025", fechaFin: "20/03/2026",
                fotos: { antes: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=500&q=60", actual: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=500&q=60" },
                actualizaciones: [ { fecha: "20/03/2026", desc: "Inauguración oficial." } ], comentarios: []
            }
        ];
        this.saveObras();
    }

    saveObras() { localStorage.setItem('ca_obras', JSON.stringify(this.obras)); }

    initObrasMap() {
        const container = document.getElementById('obras-map');
        if (!container || this.obrasMap) return;
        this.obrasMap = L.map('obras-map', { zoomControl: false }).setView(this.laRiojaCenter, 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(this.obrasMap);
        L.control.zoom({ position: 'bottomright' }).addTo(this.obrasMap);
        this.renderObrasMarkers();
    }

    renderObrasMarkers() {
        if (!this.obrasMap) return;
        this.obrasMarkers.forEach(m => this.obrasMap.removeLayer(m));
        this.obrasMarkers = [];

        const tipoFiltro = document.getElementById('filtro-tipo-obra') ? document.getElementById('filtro-tipo-obra').value : 'Todos';
        const estFiltro = document.getElementById('filtro-estado-obra') ? document.getElementById('filtro-estado-obra').value : 'Todos';

        this.obras.forEach(o => {
            if (tipoFiltro !== 'Todos' && o.tipo !== tipoFiltro) return;
            if (estFiltro !== 'Todos' && o.estado !== estFiltro) return;

            let col = '#64748b'; // Planificada
            let icon = 'fa-person-digging';
            if (o.estado === 'En Ejecución') { col = '#16a34a'; icon = 'fa-truck-fast'; }
            else if (o.estado === 'Pausada') { col = '#ca8a04'; icon = 'fa-triangle-exclamation'; }
            else if (o.estado === 'Finalizada') { col = '#2563eb'; icon = 'fa-check-double'; }

            const iconHtml = `<div style="background:${col}; color:white; border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 8px rgba(0,0,0,0.3); border:2px solid white;"><i class="fa-solid ${icon}"></i></div>`;
            const customIcon = L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [36, 36], iconAnchor: [18, 18] });
            
            const m = L.marker([o.lat, o.lng], { icon: customIcon }).addTo(this.obrasMap);
            m.bindPopup(`<b>${o.nombre}</b><br>${o.estado} (${o.avance}%)<br><button onclick="app.abrirDetalleObra(${o.id})" style="margin-top:5px; padding:5px 10px; background:var(--primary); color:white; border:none; border-radius:5px; cursor:pointer;">Ver Detalles</button>`);
            this.obrasMarkers.push(m);
        });
    }

    renderObrasList() {
        const container = document.getElementById('lista-obras');
        if (!container) return;
        container.innerHTML = '';
        
        const tipoFiltro = document.getElementById('filtro-tipo-obra') ? document.getElementById('filtro-tipo-obra').value : 'Todos';
        const estFiltro = document.getElementById('filtro-estado-obra') ? document.getElementById('filtro-estado-obra').value : 'Todos';

        const filtradas = this.obras.filter(o => {
            if (tipoFiltro !== 'Todos' && o.tipo !== tipoFiltro) return false;
            if (estFiltro !== 'Todos' && o.estado !== estFiltro) return false;
            return true;
        });

        if (filtradas.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:var(--gray-600);">No se encontraron obras con estos filtros.</p>';
            return;
        }

        filtradas.forEach(o => {
            let badgeClass = 'badge-planificada';
            if (o.estado === 'En Ejecución') badgeClass = 'badge-ejecucion';
            else if (o.estado === 'Pausada') badgeClass = 'badge-pausada';
            else if (o.estado === 'Finalizada') badgeClass = 'badge-finalizada';

            container.innerHTML += `
                <div class="obra-card" onclick="app.abrirDetalleObra(${o.id})">
                    <div class="obra-header">
                        <span class="obra-title">${o.nombre}</span>
                        <span class="obra-badge ${badgeClass}">${o.estado}</span>
                    </div>
                    <p style="font-size:0.8rem; color:var(--gray-600); margin:0;">${o.tipo} | ${o.organismo}</p>
                    <div class="obra-progress-container">
                        <div class="obra-progress-bar" style="width: ${o.avance}%"></div>
                    </div>
                    <div class="obra-progress-text">
                        <span>Avance Físico</span>
                        <span>${o.avance}%</span>
                    </div>
                </div>
            `;
        });
        
        this.renderObrasMarkers();
    }

    filtrarObras() {
        this.renderObrasList();
    }

    abrirDetalleObra(id) {
        const o = this.obras.find(x => x.id === id);
        if (!o) return;
        const modal = document.getElementById('obraModal');
        const body = document.getElementById('obra-modal-body');
        
        let fotosHtml = '';
        if (o.fotos.antes || o.fotos.actual) {
            fotosHtml = `<div style="display:flex; gap:10px; margin-bottom:15px; overflow-x:auto;">`;
            if (o.fotos.antes) fotosHtml += `<div style="flex:1; min-width:200px;"><img src="${o.fotos.antes}" style="width:100%; height:150px; object-fit:cover; border-radius:8px;"><p style="text-align:center; font-size:0.8rem; margin-top:5px; font-weight:bold;">Antes</p></div>`;
            if (o.fotos.actual) fotosHtml += `<div style="flex:1; min-width:200px;"><img src="${o.fotos.actual}" style="width:100%; height:150px; object-fit:cover; border-radius:8px;"><p style="text-align:center; font-size:0.8rem; margin-top:5px; font-weight:bold;">Actual</p></div>`;
            fotosHtml += `</div>`;
        }

        let comentariosHtml = o.comentarios.length === 0 ? '<p style="font-size:0.85rem; color:var(--gray-600);">No hay reportes ni comentarios ciudadanos aún.</p>' : '';
        o.comentarios.forEach(c => {
            comentariosHtml += `<div class="obra-comment"><b>${c.usuario}</b> (${c.fecha})<br><span style="font-size:0.9rem;">${c.texto}</span></div>`;
        });

        let actHtml = o.actualizaciones.length === 0 ? '<p style="font-size:0.85rem; color:var(--gray-600);">Sin actualizaciones recientes.</p>' : '';
        o.actualizaciones.forEach(a => {
            actHtml += `<div style="margin-bottom:8px; font-size:0.9rem;"><b>${a.fecha}:</b> ${a.desc}</div>`;
        });

        body.innerHTML = `
            <h2 style="color:var(--primary); margin-bottom:5px;">${o.nombre}</h2>
            <p style="color:var(--gray-600); margin-bottom:20px;">${o.tipo} | ${o.organismo}</p>
            
            ${fotosHtml}
            
            <div class="obra-modal-grid">
                <div class="obra-data-section">
                    <h3 style="margin-bottom:15px; font-size:1.1rem; border-bottom:2px solid var(--primary); padding-bottom:5px;">Ficha Técnica</h3>
                    <div class="obra-data-row"><span class="obra-data-label">Presupuesto</span><span class="obra-data-value">${o.presupuesto}</span></div>
                    <div class="obra-data-row"><span class="obra-data-label">Financiamiento</span><span class="obra-data-value">${o.financiamiento}</span></div>
                    <div class="obra-data-row"><span class="obra-data-label">Fecha Inicio</span><span class="obra-data-value">${o.fechaInicio}</span></div>
                    <div class="obra-data-row"><span class="obra-data-label">Fin Estimado</span><span class="obra-data-value">${o.fechaFin}</span></div>
                    <div class="obra-data-row"><span class="obra-data-label">Estado</span><span class="obra-data-value">${o.estado}</span></div>
                    
                    <div style="margin-top:20px;">
                        <span class="obra-data-label" style="display:block; margin-bottom:5px;">Progreso de Obra (${o.avance}%)</span>
                        <div class="obra-progress-container"><div class="obra-progress-bar" style="width: ${o.avance}%"></div></div>
                    </div>
                </div>
                
                <div class="obra-data-section">
                    <h3 style="margin-bottom:15px; font-size:1.1rem; border-bottom:2px solid var(--primary); padding-bottom:5px;">Actualizaciones Oficiales</h3>
                    ${actHtml}

                    <h3 style="margin-top:25px; margin-bottom:15px; font-size:1.1rem; border-bottom:2px solid var(--primary); padding-bottom:5px;">Control Ciudadano</h3>
                    <div class="obra-comments-list">${comentariosHtml}</div>
                    <div style="margin-top:15px; display:flex; gap:10px;">
                        <input type="text" id="nuevo-comentario-${o.id}" placeholder="Escribe tu observación o reporte..." style="flex:1;">
                        <button class="btn-primary" style="width:auto; padding:10px 15px; margin:0;" onclick="app.agregarComentarioObra(${o.id})">Enviar</button>
                    </div>
                </div>
            </div>
        `;
        
        modal.classList.add('active');
    }

    cerrarDetalleObra() {
        document.getElementById('obraModal').classList.remove('active');
    }

    agregarComentarioObra(id) {
        if (!this.user) return this.showToast("Debes iniciar sesión", "error");
        const input = document.getElementById(`nuevo-comentario-${id}`);
        if (!input || !input.value.trim()) return;
        
        const o = this.obras.find(x => x.id === id);
        if (o) {
            o.comentarios.push({
                usuario: this.user.name,
                fecha: new Date().toLocaleDateString(),
                texto: input.value.trim()
            });
            this.saveObras();
            this.showToast("Comentario enviado", "success");
            this.abrirDetalleObra(id);
        }
    }

    descargarDatosObras() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.obras, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "gobierno_la_rioja_obras_publicas.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        this.showToast("Descarga de Datos Abiertos iniciada", "success");
    }

    seedData() { this.reports = [{ id: 1, name: "Admin", cat: "Calles", desc: "Bache inicial", pos: [-29.412, -66.856], estado: "Recibido", urgency: "Alto", fecha: "25/4/2026" }]; }

    // --- ADMIN OBRAS ---
    renderAdminObrasList() {
        const container = document.getElementById('admin-lista-obras');
        if (!container) return;
        container.innerHTML = '';

        if (this.obras.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:var(--gray-600); width:100%;">No hay obras registradas.</p>';
            return;
        }

        this.obras.forEach(o => {
            let badgeClass = 'badge-planificada';
            if (o.estado === 'En Ejecución') badgeClass = 'badge-ejecucion';
            else if (o.estado === 'Pausada') badgeClass = 'badge-pausada';
            else if (o.estado === 'Finalizada') badgeClass = 'badge-finalizada';

            container.innerHTML += `
                <div class="card" style="margin-bottom:10px; border-left: 5px solid var(--primary)">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <h3 style="margin:0;">${o.nombre}</h3>
                        <span class="obra-badge ${badgeClass}">${o.estado} (${o.avance}%)</span>
                    </div>
                    <p style="margin-bottom:10px; font-size:0.9rem;">${o.tipo} | ${o.organismo}</p>
                    <div style="display:flex; gap:10px;">
                        <button onclick="app.abrirModalActualizarObra(${o.id})" class="btn-primary" style="padding:8px; font-size:0.85rem; margin:0;"><i class="fa-solid fa-pen-to-square"></i> Actualizar</button>
                    </div>
                </div>
            `;
        });
    }

    abrirModalNuevaObra() {
        document.getElementById('adminNuevaObraModal').classList.add('active');
        this.tempObraLatLng = null;
        setTimeout(() => this.initSelectObraMap(), 300);
    }

    cerrarModalNuevaObra() {
        document.getElementById('adminNuevaObraModal').classList.remove('active');
        document.getElementById('form-nueva-obra').reset();
        if (this.tempObraMarker && this.selectObraMap) {
            this.selectObraMap.removeLayer(this.tempObraMarker);
            this.tempObraMarker = null;
        }
    }

    initSelectObraMap() {
        if (!this.selectObraMap) {
            this.selectObraMap = L.map('select-obra-map', { zoomControl: false }).setView(this.laRiojaCenter, 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(this.selectObraMap);
            L.control.zoom({ position: 'bottomright' }).addTo(this.selectObraMap);

            this.selectObraMap.on('click', (e) => {
                this.tempObraLatLng = e.latlng;
                if (this.tempObraMarker) this.selectObraMap.removeLayer(this.tempObraMarker);
                this.tempObraMarker = L.marker(e.latlng).addTo(this.selectObraMap);
            });
        } else {
            this.selectObraMap.invalidateSize();
        }
    }

    guardarNuevaObra(e) {
        e.preventDefault();
        if (!this.tempObraLatLng) return this.showToast("Debe seleccionar la ubicación en el mapa", "error");

        const nuevaObra = {
            id: Date.now(),
            nombre: document.getElementById('n-obra-nombre').value,
            tipo: document.getElementById('n-obra-tipo').value,
            lat: this.tempObraLatLng.lat,
            lng: this.tempObraLatLng.lng,
            organismo: document.getElementById('n-obra-org').value,
            presupuesto: document.getElementById('n-obra-presupuesto').value,
            financiamiento: document.getElementById('n-obra-fin').value,
            estado: document.getElementById('n-obra-estado').value,
            avance: document.getElementById('n-obra-estado').value === 'En Ejecución' ? 5 : 0,
            fechaInicio: document.getElementById('n-obra-inicio').value,
            fechaFin: document.getElementById('n-obra-fin-est').value,
            fotos: { antes: "", actual: "" },
            actualizaciones: [{ fecha: new Date().toLocaleDateString(), desc: "Obra registrada en el sistema." }],
            comentarios: []
        };

        this.obras.push(nuevaObra);
        this.saveObras();
        this.showToast("Obra registrada correctamente", "success");
        this.cerrarModalNuevaObra();
        this.renderAdminObrasList();
    }

    abrirModalActualizarObra(id) {
        const o = this.obras.find(x => x.id === id);
        if (!o) return;
        document.getElementById('a-obra-id').value = o.id;
        document.getElementById('a-obra-estado').value = o.estado;
        document.getElementById('a-obra-avance').value = o.avance;
        document.getElementById('a-obra-novedad').value = '';
        document.getElementById('adminActualizarObraModal').classList.add('active');
    }

    cerrarModalActualizarObra() {
        document.getElementById('adminActualizarObraModal').classList.remove('active');
    }

    guardarActualizacionObra(e) {
        e.preventDefault();
        const id = parseInt(document.getElementById('a-obra-id').value);
        const o = this.obras.find(x => x.id === id);
        if (o) {
            o.estado = document.getElementById('a-obra-estado').value;
            o.avance = parseInt(document.getElementById('a-obra-avance').value);
            
            const novedadText = document.getElementById('a-obra-novedad').value.trim();
            if (novedadText) {
                o.actualizaciones.push({
                    fecha: new Date().toLocaleDateString(),
                    desc: novedadText
                });
            }
            
            this.saveObras();
            this.showToast("Obra actualizada correctamente", "success");
            this.cerrarModalActualizarObra();
            this.renderAdminObrasList();
        }
    }

    // --- TRANSPORTE INTELIGENTE ---
    initTransporteMap() {
        if (!this.transporteMap) {
            this.transporteMap = L.map('transporte-map', { zoomControl: false }).setView(this.laRiojaCenter, 14);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(this.transporteMap);
            L.control.zoom({ position: 'bottomright' }).addTo(this.transporteMap);
            
            this.transporteMarkers = [];
            this.transporteBuses = [];
            this.transportePolyline = null;

            // Datos mock de rutas
            this.rutasTransporte = {
                "1": {
                    nombre: "Línea Troncal Norte-Sur",
                    color: "#e6192b",
                    puntos: [
                        [-29.390, -66.865], [-29.400, -66.860], [-29.410, -66.855], [-29.420, -66.850], [-29.430, -66.845]
                    ],
                    paradas: [
                        { nombre: "Terminal Norte", lat: -29.390, lng: -66.865 },
                        { nombre: "Plaza Principal", lat: -29.410, lng: -66.855 },
                        { nombre: "Hospital Sur", lat: -29.430, lng: -66.845 }
                    ]
                },
                "2": {
                    nombre: "Línea Troncal Este-Oeste",
                    color: "#0a66c2",
                    puntos: [
                        [-29.410, -66.830], [-29.413, -66.845], [-29.4131, -66.8558], [-29.415, -66.870], [-29.418, -66.885]
                    ],
                    paradas: [
                        { nombre: "Barrio Este", lat: -29.410, lng: -66.830 },
                        { nombre: "Centro Cívico", lat: -29.4131, lng: -66.8558 },
                        { nombre: "Universidad", lat: -29.418, lng: -66.885 }
                    ]
                }
            };
            
            this.cambiarLineaTransporte();
            this.iniciarSimulacionTransporte();
        } else {
            this.transporteMap.invalidateSize();
        }
    }

    cambiarLineaTransporte() {
        if (!this.transporteMap) return;
        
        const lineaId = document.getElementById('transporte-linea').value;
        const ruta = this.rutasTransporte[lineaId];
        if (!ruta) return;

        // Limpiar mapa
        if (this.transportePolyline) this.transporteMap.removeLayer(this.transportePolyline);
        this.transporteMarkers.forEach(m => this.transporteMap.removeLayer(m));
        this.transporteMarkers = [];
        this.transporteBuses.forEach(b => this.transporteMap.removeLayer(b.marker));
        this.transporteBuses = [];

        // Dibujar ruta
        this.transportePolyline = L.polyline(ruta.puntos, { color: ruta.color, weight: 5, opacity: 0.7 }).addTo(this.transporteMap);
        this.transporteMap.fitBounds(this.transportePolyline.getBounds());

        // Dibujar paradas
        const listaParadas = document.getElementById('transporte-paradas-lista');
        listaParadas.innerHTML = '';
        
        const paradaIcon = L.divIcon({ html: '<div style="background:white; border:3px solid var(--text); border-radius:50%; width:16px; height:16px;"></div>', className: '', iconSize: [16,16], iconAnchor: [8,8] });

        ruta.paradas.forEach((p, idx) => {
            const m = L.marker([p.lat, p.lng], { icon: paradaIcon }).addTo(this.transporteMap);
            m.bindPopup(`<b>${p.nombre}</b><br><button onclick="app.abrirEtaCard(${lineaId}, ${idx})" class="btn-primary" style="padding:5px 10px; margin-top:5px;">Ver Horarios</button>`);
            this.transporteMarkers.push(m);

            listaParadas.innerHTML += `
                <div class="transporte-parada-item" onclick="app.abrirEtaCard(${lineaId}, ${idx})">
                    <div>
                        <b style="color:var(--text);">${p.nombre}</b>
                        <p style="margin:0; font-size:0.8rem; color:var(--gray-600);"><i class="fa-solid fa-location-dot"></i> A ${(Math.random() * 5 + 1).toFixed(1)} km</p>
                    </div>
                    <i class="fa-solid fa-chevron-right" style="color:var(--gray-600);"></i>
                </div>
            `;
        });

        // Crear buses iniciales
        this.crearBusesSimulados(ruta);
        this.cerrarEtaCard();
    }

    crearBusesSimulados(ruta) {
        const busIcon = L.divIcon({ html: `<div style="background:${ruta.color}; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 8px rgba(0,0,0,0.3); border:2px solid white;"><i class="fa-solid fa-bus"></i></div>`, className: '', iconSize: [30,30], iconAnchor: [15,15] });
        
        // Crear 2 buses en posiciones intermedias
        this.transporteBuses = [
            { marker: L.marker(ruta.puntos[0], { icon: busIcon }).addTo(this.transporteMap), idx: 0, progreso: 0 },
            { marker: L.marker(ruta.puntos[Math.floor(ruta.puntos.length/2)], { icon: busIcon }).addTo(this.transporteMap), idx: Math.floor(ruta.puntos.length/2), progreso: 0 }
        ];
    }

    iniciarSimulacionTransporte() {
        if (this.simuladorTransporteInterval) clearInterval(this.simuladorTransporteInterval);
        
        this.simuladorTransporteInterval = setInterval(() => {
            const lineaId = document.getElementById('transporte-linea').value;
            const ruta = this.rutasTransporte[lineaId];
            if (!ruta || this.transporteBuses.length === 0) return;

            this.transporteBuses.forEach(bus => {
                bus.progreso += 0.05; // Velocidad simulada
                if (bus.progreso >= 1) {
                    bus.progreso = 0;
                    bus.idx++;
                    if (bus.idx >= ruta.puntos.length - 1) {
                        bus.idx = 0; // Reiniciar ruta (loop)
                    }
                }

                // Interpolar posición
                const p1 = ruta.puntos[bus.idx];
                const p2 = ruta.puntos[bus.idx + 1];
                if (p1 && p2) {
                    const lat = p1[0] + (p2[0] - p1[0]) * bus.progreso;
                    const lng = p1[1] + (p2[1] - p1[1]) * bus.progreso;
                    bus.marker.setLatLng([lat, lng]);
                }
            });

            // Actualizar ETA dinámico si está abierto
            if (this.etaActual && this.etaActual.lineaId == lineaId) {
                const minutos = Math.floor(Math.random() * 3) + 1; // ETA Simulado
                document.getElementById('eta-minutos').textContent = minutos;
                if (minutos === 1 && !this.notificacionEnviada) {
                    this.showToast("¡Tu colectivo está llegando a la parada!", "success");
                    this.notificacionEnviada = true;
                }
            }
        }, 1000);
    }

    abrirEtaCard(lineaId, paradaIdx) {
        const ruta = this.rutasTransporte[lineaId];
        const parada = ruta.paradas[paradaIdx];
        if (!ruta || !parada) return;

        document.getElementById('eta-parada-nombre').textContent = parada.nombre;
        document.getElementById('eta-linea-nombre').textContent = ruta.nombre;
        document.getElementById('eta-minutos').textContent = Math.floor(Math.random() * 10) + 2;
        document.getElementById('eta-distancia').textContent = `Aprox. ${(Math.random() * 1.5 + 0.5).toFixed(1)} km de distancia`;
        
        document.getElementById('transporte-eta-card').classList.add('active');
        this.etaActual = { lineaId, paradaIdx };
        this.notificacionEnviada = false;

        // Resaltar parada en la lista
        document.querySelectorAll('.transporte-parada-item').forEach((el, i) => {
            if (i === paradaIdx) el.classList.add('active');
            else el.classList.remove('active');
        });
        
        // Hacer zoom en la parada en el mapa
        this.transporteMap.setView([parada.lat, parada.lng], 16);
    }

    cerrarEtaCard() {
        document.getElementById('transporte-eta-card').classList.remove('active');
        this.etaActual = null;
        document.querySelectorAll('.transporte-parada-item').forEach(el => el.classList.remove('active'));
    }

    buscarTransporte() {
        const val = document.getElementById('transporte-buscar').value.toLowerCase();
        // Simulación visual rápida
        const lista = document.getElementById('transporte-paradas-lista');
        Array.from(lista.children).forEach(el => {
            const nombre = el.querySelector('b').textContent.toLowerCase();
            if (nombre.includes(val)) el.style.display = 'flex';
            else el.style.display = 'none';
        });
    }

    // --- ALERTAS DE SERVICIOS PÚBLICOS ---
    initServiciosMap() {
        // Cargar datos del localStorage o usar mock
        if (!localStorage.getItem('ca_servicios_alertas')) {
            const mockAlertas = [
                { id: 1, servicio: "Agua", zona: "Barrio Centro", desc: "Rotura de caño matriz. Baja presión.", lat: -29.413, lng: -66.855, radio: 400, color: "#0ea5e9", eta: "18:00 hs", oficial: true },
                { id: 2, servicio: "Energía", zona: "Zona Sur", desc: "Mantenimiento programado de transformador.", lat: -29.435, lng: -66.850, radio: 600, color: "#eab308", eta: "14:30 hs", oficial: true },
                { id: 3, servicio: "Gas", zona: "Barrio Hospital", desc: "Trabajos de empalme en red domiciliaria.", lat: -29.420, lng: -66.865, radio: 300, color: "#f97316", eta: "Mañana 08:00 hs", oficial: true }
            ];
            localStorage.setItem('ca_servicios_alertas', JSON.stringify(mockAlertas));
        }
        this.serviciosAlertas = JSON.parse(localStorage.getItem('ca_servicios_alertas'));

        if (!this.serviciosMap) {
            this.serviciosMap = L.map('servicios-map', { zoomControl: false }).setView(this.laRiojaCenter, 14);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(this.serviciosMap);
            L.control.zoom({ position: 'bottomright' }).addTo(this.serviciosMap);
            this.serviciosCapas = [];

            // Añadir clic para reportar falla desde el mapa de servicios
            this.serviciosMap.on('click', (e) => {
                this.tempServicioPos = e.latlng;
                if (this.tempServicioMarker) this.serviciosMap.removeLayer(this.tempServicioMarker);
                this.tempServicioMarker = L.marker(e.latlng, {
                    icon: L.divIcon({
                        html: '<i class="fa-solid fa-location-crosshairs" style="color:var(--danger); font-size:1.5rem;"></i>',
                        className: 'temp-marker', iconSize:[30,30], iconAnchor:[15,15]
                    })
                }).addTo(this.serviciosMap);
                
                this.tempServicioMarker.bindPopup(`
                    <div style="text-align:center;">
                        <b>Ubicación del Problema</b><br>
                        <button onclick="app.abrirModalReporteServicio()" style="margin-top:10px; padding:5px 10px; background:var(--danger); color:white; border:none; border-radius:5px; cursor:pointer;">Reportar aquí</button>
                    </div>
                `).openPopup();
            });
        } else {
            this.serviciosMap.invalidateSize();
        }

        this.renderServiciosAlertas();
    }

    renderServiciosAlertas() {
        const lista = document.getElementById('servicios-lista-alertas');
        if (!lista || !this.serviciosMap) return;
        lista.innerHTML = '';

        // Limpiar mapa
        this.serviciosCapas.forEach(c => this.serviciosMap.removeLayer(c));
        this.serviciosCapas = [];

        if (this.serviciosAlertas.length === 0) {
            lista.innerHTML = '<p style="text-align:center; color:var(--gray-600); padding:20px;">No hay alertas activas en este momento.</p>';
            return;
        }

        this.serviciosAlertas.forEach(a => {
            // Dibujar en mapa
            const circle = L.circle([a.lat, a.lng], {
                color: a.color, fillColor: a.color, fillOpacity: 0.2, radius: a.radio
            }).addTo(this.serviciosMap);
            
            let iconHtml = "";
            if (a.servicio === "Agua") iconHtml = '<i class="fa-solid fa-droplet" style="color:#0ea5e9;"></i>';
            if (a.servicio === "Energía") iconHtml = '<i class="fa-solid fa-bolt" style="color:#eab308;"></i>';
            if (a.servicio === "Gas") iconHtml = '<i class="fa-solid fa-fire-flame-simple" style="color:#f97316;"></i>';

            circle.bindPopup(`<b>${iconHtml} ${a.servicio} - ${a.zona}</b><br><small>${a.desc}</small><br><b>ETA:</b> ${a.eta}`);
            this.serviciosCapas.push(circle);

            // Agregar a lista
            const isOficial = a.oficial ? '<i class="fa-solid fa-check-circle" style="color:var(--success);" title="Información Oficial"></i>' : '<i class="fa-solid fa-user-clock" style="color:var(--warning);" title="Reporte Ciudadano (No confirmado)"></i>';
            
            lista.innerHTML += `
                <div class="alerta-item alerta-${a.servicio}" onclick="app.centrarMapaServicio(${a.lat}, ${a.lng})">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <h4 style="margin:0; font-size:1rem; display:flex; align-items:center; gap:5px;">
                            ${iconHtml} ${a.servicio} en ${a.zona}
                        </h4>
                        ${isOficial}
                    </div>
                    <p style="margin:5px 0 0 0; font-size:0.9rem; color:var(--gray-600);">${a.desc}</p>
                    <div class="alerta-eta">
                        <i class="fa-solid fa-clock"></i> Reparación est.: ${a.eta}
                    </div>
                </div>
            `;
        });
    }

    centrarMapaServicio(lat, lng) {
        if (this.serviciosMap) {
            this.serviciosMap.setView([lat, lng], 15);
        }
    }

    abrirModalReporteServicio() {
        document.getElementById('reporteServicioModal').classList.add('active');
    }

    cerrarModalReporteServicio() {
        document.getElementById('reporteServicioModal').classList.remove('active');
        document.getElementById('form-reporte-servicio').reset();
    }

    guardarReporteServicio(e) {
        e.preventDefault();
        const tipo = document.getElementById('rs-tipo').value;
        const zona = document.getElementById('rs-zona').value;
        const desc = document.getElementById('rs-desc').value;
        
        let color = "#eab308"; // Default energia
        if (tipo === "Agua") color = "#0ea5e9";
        if (tipo === "Gas") color = "#f97316";

        // Usar la posición marcada en el mapa si existe, si no, usar una aleatoria
        const lat = this.tempServicioPos ? this.tempServicioPos.lat : (this.laRiojaCenter[0] + (Math.random() - 0.5) * 0.02);
        const lng = this.tempServicioPos ? this.tempServicioPos.lng : (this.laRiojaCenter[1] + (Math.random() - 0.5) * 0.02);

        const nuevoReporte = {
            id: Date.now(),
            servicio: tipo,
            zona: zona,
            desc: desc,
            lat: lat,
            lng: lng,
            radio: 150, // Más pequeño para reporte ciudadano
            color: color,
            eta: "Evaluando...",
            oficial: false
        };

        this.serviciosAlertas.push(nuevoReporte);
        localStorage.setItem('ca_servicios_alertas', JSON.stringify(this.serviciosAlertas));
        
        this.showToast("Reporte enviado. Las cuadrillas han sido notificadas.", "success");
        this.cerrarModalReporteServicio();
        this.renderServiciosAlertas();
        this.centrarMapaServicio(lat, lng);
    }

    seedData() {
        this.reports = [
            { id: 1, name: "Admin", cat: "Calles", desc: "Bache inicial", pos: [-29.412, -66.856], estado: "Recibido", urgency: "Alto", fecha: "25/4/2026" }
        ];
        localStorage.setItem('ca_reports', JSON.stringify(this.reports));
    }

    toggleSOS() { document.getElementById('sos-menu').classList.toggle('active'); }
    callSOS(type) { this.showToast(`Llamando a ${type}...`, "success"); }

    // --- REPORTE INTELIGENTE (AUDIO + FOTO) ---
    async iniciarGrabacion() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return this.showToast("Tu navegador no soporta grabación de audio", "error");
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = async () => {
                this.audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.audioBase64 = await this.blobToBase64(this.audioBlob);
                
                const audioPlayer = document.getElementById('audio-player');
                if (audioPlayer) {
                    audioPlayer.src = URL.createObjectURL(this.audioBlob);
                    document.getElementById('audio-preview').style.display = 'block';
                    document.getElementById('btn-borrar-audio').style.display = 'block';
                }
            };

            this.mediaRecorder.start();
            this.startTimer();
            
            const statusDiv = document.getElementById('audio-record-status');
            const mobileBtn = document.getElementById('mobile-audio-btn');
            const mobileStatus = document.getElementById('mobile-audio-status');

            if (statusDiv) {
                statusDiv.classList.add('recording');
                document.getElementById('audio-status-text').innerText = "Grabando audio...";
                document.getElementById('btn-grabar').disabled = true;
                document.getElementById('btn-detener').disabled = false;
            }

            if (mobileBtn) {
                mobileBtn.classList.add('recording');
                mobileBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
                if (mobileStatus) {
                    mobileStatus.innerText = "Grabando...";
                    mobileStatus.classList.add('show');
                }
            }
            this.recording = true;
            this.showToast("🎙️ Grabando...", "info");
        } catch (err) {
            console.error("Error al acceder al micrófono:", err);
            this.showToast("Error: Permití acceso al micrófono", "error");
        }
    }

    detenerGrabacion() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.stopTimer();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            
            const statusDiv = document.getElementById('audio-record-status');
            const mobileBtn = document.getElementById('mobile-audio-btn');
            const mobileStatus = document.getElementById('mobile-audio-status');

            if (statusDiv) {
                statusDiv.classList.remove('recording');
                document.getElementById('audio-status-text').innerText = "Grabación finalizada";
                document.getElementById('btn-grabar').disabled = false;
                document.getElementById('btn-detener').disabled = true;
            }

            if (mobileBtn) {
                mobileBtn.classList.remove('recording');
                mobileBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                if (mobileStatus) {
                    mobileStatus.innerText = "Audio guardado";
                    setTimeout(() => mobileStatus.classList.remove('show'), 2000);
                }
            }
            this.recording = false;
        }
    }

    borrarAudio() {
        this.audioBlob = null;
        this.audioBase64 = null;
        const preview = document.getElementById('audio-preview');
        if (preview) {
            preview.style.display = 'none';
            document.getElementById('btn-borrar-audio').style.display = 'none';
            document.getElementById('audio-status-text').innerText = "Listo para grabar";
            document.getElementById('audio-timer').innerText = "0:00";
        }
        this.seconds = 0;
    }

    startTimer() {
        this.seconds = 0;
        const timerText = document.getElementById('audio-timer');
        if (!timerText) return;
        this.timerInterval = setInterval(() => {
            this.seconds++;
            const mins = Math.floor(this.seconds / 60);
            const secs = this.seconds % 60;
            timerText.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
    }

    blobToBase64(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    previewPhoto(input) {
        const preview = document.getElementById('photo-preview-img');
        const placeholder = document.getElementById('photo-placeholder');
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (preview && placeholder) {
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                    placeholder.style.display = 'none';
                }
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    simularLlamada(nombre) {
        this.showToast(`📞 Iniciando llamada a ${nombre}...`, "success");
    }

    simularMensaje(nombre) {
        this.showToast(`💬 Enviando mensaje directo a ${nombre}...`, "success");
    }

    // --- SISTEMA DE FEEDBACK ---
    setRating(id, val) {
        this.tempRating = val;
        const btns = document.querySelectorAll(`#stars-${id} .star-btn`);
        btns.forEach((btn, i) => {
            if (i < val) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    enviarFeedback(id) {
        const r = this.reports.find(x => x.id == id);
        if (r) {
            const comment = document.getElementById(`feedback-msg-${id}`).value;
            r.feedback = {
                calificacion: this.tempRating || 5,
                comentario: comment || "¡Muchas gracias por la solución!",
                agradecimiento: true,
                fecha: new Date().toLocaleDateString()
            };
            this.save();
            this.showToast("🙌 ¡Gracias por tu devolución! Motiva mucho al equipo.", "success");
            this.renderCitizenList();
        }
    }

    // --- SISTEMA DE CHAT ---
    toggleChat(id) {
        const container = document.getElementById(`chat-container-${id}`);
        if (container) {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
        }
    }

    enviarMensaje(id, autor) {
        const r = this.reports.find(x => x.id == id);
        const input = document.getElementById(`chat-input-${id}`);
        if (r && input && input.value.trim() !== '') {
            if (!r.mensajes) r.mensajes = [];
            r.mensajes.push({
                autor: autor,
                texto: input.value.trim(),
                fecha: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            this.save();
            input.value = '';
            
            if (autor === 'funcionario') {
                this.showToast("✉️ Mensaje enviado al vecino", "success");
                this.renderAdminList();
                // Notificación para el ciudadano (simulada)
                let notifs = JSON.parse(localStorage.getItem('ca_notifications')) || [];
                notifs.push({ user: r.name, msg: `Nuevo mensaje del Gobierno sobre tu reporte de ${r.cat}` });
                localStorage.setItem('ca_notifications', JSON.stringify(notifs));
            } else {
                this.showToast("✉️ Mensaje enviado al funcionario", "success");
                this.renderCitizenList();
            }
        }
    }
}

const app = new CiudadActivaApp();
window.app = app;
