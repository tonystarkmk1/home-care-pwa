(function(){
  function hasSession(){
    try { return !!localStorage.getItem('hc_token'); } catch(e) { return false; }
  }

  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || /HomeCareAndroid/i.test(navigator.userAgent || '');
  }

  function shouldHideInstall(){
    return isStandalone() || hasSession();
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
    document.querySelectorAll('.hc-install-direct').forEach(function(btn){ btn.remove(); });
  }

  async function handleInstallClick(){
    if(shouldHideInstall()) { hideInstallButtons(); return; }
    window.location.href = '/scarica-android.html';
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
    if(shouldHideInstall()) return false;
    if(document.getElementById('homecare-install-header') || document.querySelector('.hc-install-direct')) return true;
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
    if(shouldHideInstall()) return;
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
    if(shouldHideInstall()) { hideInstallButtons(); return; }
    var headerOk = showHeaderButton();
    if(!headerOk) showFloatingButton();
  }

  function init(){
    if(shouldHideInstall()) { hideInstallButtons(); return; }
    showInstallButtons();
    var tries = 0;
    var timer = setInterval(function(){
      tries += 1;
      if(shouldHideInstall()) { hideInstallButtons(); clearInterval(timer); return; }
      showInstallButtons();
      if(tries >= 10 || document.getElementById('homecare-install-header') || document.querySelector('.hc-install-direct')) clearInterval(timer);
    }, 700);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
