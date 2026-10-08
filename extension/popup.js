'use strict';
const fields = ['enabled', 'width'];
const status = document.querySelector('#status');
async function init() {
  try {
    const values = await chrome.storage.local.get({ enabled: true, width: 88 });
    for (const key of fields) {
      const input = document.getElementById(key);
      if (input.type === 'checkbox') input.checked = values[key];
      else input.value = String(values[key]);
      input.addEventListener('change', async () => {
        const value = input.type === 'checkbox' ? input.checked : Number(input.value);
        try {
          await chrome.storage.local.set({ [key]: value });
          status.textContent = 'Preferência salva.';
        } catch { status.textContent = 'Não foi possível salvar. Reabra a extensão.'; }
      });
    }
  } catch { status.textContent = 'Abra este painel pelo ícone da extensão no Chrome.'; }
}
init();
