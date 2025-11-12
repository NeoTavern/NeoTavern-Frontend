(function () {
  console.log('Loading Example Button extension...');
  const interval = setInterval(() => {
    const container = document.getElementById('extension-buttons-container');
    if (container) {
      clearInterval(interval);
      const button = document.createElement('div');
      button.className = 'menu-button fa-solid fa-flask';
      button.title = 'Example Extension Button';
      button.onclick = () => alert('Extension button clicked!');
      container.appendChild(button);
      console.log('Example Button extension loaded.');
    }
  }, 100);
})();
