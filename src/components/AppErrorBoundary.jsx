import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled application error', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.assign('/');
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="card w-full max-w-md text-center">
          <AlertTriangle size={42} className="mx-auto mb-4 text-amber-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Не удалось открыть этот экран
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            Данные не потеряны. Обновите приложение; если ошибка повторится, вернитесь на главную страницу.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-2">
            <button type="button" onClick={this.handleReload} className="btn-primary">
              <RefreshCw size={16} className="mr-2" />
              Обновить
            </button>
            <button type="button" onClick={this.handleGoHome} className="btn-secondary">
              <Home size={16} className="mr-2" />
              На главную
            </button>
          </div>
        </div>
      </div>
    );
  }
}
