(function () {
  console.log('Loading Example Vue Component extension...');

  if (!window.Vue) {
    console.error('Vue is not available on the window object. This extension cannot run.');
    return;
  }
  const { createApp } = window.Vue;

  const MyComponent = {
    data() {
      return {
        message: 'Hello from a Vue component in an extension!',
      };
    },
    template: `
            <div class="example-vue-component" @click="greet">
                <p>{{ message }}</p>
            </div>
        `,
    methods: {
      greet() {
        alert('Clicked the Vue component!');
      },
    },
  };

  const interval = setInterval(() => {
    const anchor = document.getElementById('character-search-form');
    if (anchor && anchor.parentElement && !document.getElementById('example-vue-component-mount')) {
      clearInterval(interval);

      const mountPoint = document.createElement('div');
      mountPoint.id = 'example-vue-component-mount';
      anchor.parentElement.insertBefore(mountPoint, anchor.nextSibling);

      createApp(MyComponent).mount('#example-vue-component-mount');
      console.log('Example Vue Component extension loaded.');
    }
  }, 100);
})();
