(function(){
  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || /HomeCareAndroid/i.test(navigator.userAgent || '');
  }

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function(event){
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', function(){
    hideInstallButton();
  });

  function hideInstallButton(){
    var btn = document.getElementById('homecare-install-floating');
    if(btn) btn.remove();
  }

  function showInstallButton(){
    if(isStandalone()) { hideInstallButton(); return; }
    if(document.getElementById('homecare-install-floating')) return;

    var btn = document.createElement('button');
    btn.id = 'homecare-install-floating';
    btn.type = 'button';
    btn.textContent = 'Installa app';
    btn.style.position = 'fixed';
    btn.style.right = '14px';
    btn.style.bottom = '22px';
    btn.style.zIndex = '999999';
    btn.style.border = '0';
    btn.style.borderRadius = '999px';
    btn.style.padding = '14px 18px';
    btn.style.background = '#c7952d';
    btn.style.color = '#071d30';
    btn.style.fontWeight = '900';
    btn.style.fontSize = '16px';
    btn.style.boxShadow = '0 12px 28px rgba(6,36,58,.30)';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', async function(){
      if(isStandalone()) { hideInstallButton(); return; }
      var ua = navigator.userAgent || '';
      if(/Android/i.test(ua)) {
        window.location.href = '/scarica-android.html';
        return;
      }
      if(deferredPrompt) {
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch(e) {}
        deferredPrompt = null;
        hideInstallButton();
        return;
      }
      alert('Su iPhone apri il sito da Safari, premi Condividi e scegli Aggiungi a schermata Home.');
    });

    document.body.appendChild(btn);
  }

  function init(){
    if(isStandalone()) { hideInstallButton(); return; }
    showInstallButton();
    setTimeout(showInstallButton, 1500);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
