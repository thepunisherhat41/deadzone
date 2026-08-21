(()=>{
  try {
    const saved = localStorage.getItem('deadzone_server_url') || '';
    const nativeLike = location.hostname === 'localhost' && location.protocol !== 'http:';
    const fallback = nativeLike ? 'wss://deadzone-ru4d.onrender.com' : '';
    window.DEADZONE_WS_URL = saved || fallback;
  } catch {
    window.DEADZONE_WS_URL = '';
  }
})();
