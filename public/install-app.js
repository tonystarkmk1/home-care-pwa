(function(){
  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || /HomeCareAndroid/i.test(navigator.userAgent || '');
  }

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function(event){
    event.preventDefault();
    deferredPrompt = event;
    showInstallButtons();
  });

  window.addEventListener('appinstalled', function(){
    hideInstallButtons();
  });

  function hideInstallButtons(){
    ['homecare-install-floating','homecare-install-header'].forEach(function(id){
      var btn = document.getElementById(id);
      if(btn) btn.remove();
    });
  }

  async function handleInstallClick(){
    if(isStandalone()) { hideInstallButtons(); return; }
    var ua = navigator.userAgent || '';
    if(/Android/i.test(ua)) {
      window.location.href = '/scarica-android.html';
      return;
    }
    if(deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch(e) {}
      deferredPrompt = null;
      hideInstallButtons();
      return;
    }
    alert('Su iPhone apri il sito da Safari, premi Condividi e scegli Aggiungi a schermata Home.');
  }

  function makeButton(id){
    var btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = 'Installa app';
    btn.addEventListener('click', handleInstallClick);
    return btn;
  }

  function showHeaderButton(){
    if(isStandalone()) return false;
    if(document.getElementById('homecare-install-header')) return true;
    var top = document.querySelector('.top');
    if(!top) return false;
    var target = top.children && top.children.length ? top.children[top.children.length - 1] : top;
    if(!target) return false;
    var btn = makeButton('homecare-install-header');
    btn.className = 'btn light small';
    btn.style.marginRight = '8px';
    target.insertBefore(btn, target.firstChild);
    return true;
  }

  function showFloatingButton(){
    if(isStandalone()) return;
    if(document.getElementById('homecare-install-floating')) return;

    var btn = makeButton('homecare-install-floating');
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
    document.body.appendChild(btn);
  }

  function showInstallButtons(){
    if(isStandalone()) { hideInstallButtons(); return; }
    var headerOk = showHeaderButton();
    if(!headerOk) showFloatingButton();
  }

  function init(){
    if(isStandalone()) { hideInstallButtons(); return; }
    showInstallButtons();
    var tries = 0;
    var timer = setInterval(function(){
      tries += 1;
      showInstallButtons();
      if(tries >= 8 || document.getElementById('homecare-install-header')) clearInterval(timer);
    }, 700);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
