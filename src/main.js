const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 1100,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC 통신 설정
ipcMain.handle('save-file', async (event, { fileName, data }) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    });
    
    if (filePath) {
      fs.writeFileSync(filePath, Buffer.from(data));
      return { 
        success: true, 
        filePath: filePath,
        fileName: path.basename(filePath)
      };
    }
    return { success: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Ollama 상태 확인 및 자동 실행 함수
function checkAndStartOllama() {
  return new Promise((resolve, reject) => {
    // Ollama 설치 여부 확인 (플랫폼별 처리)
    const checkCommand = os.platform() === 'win32' ? 'where ollama' : 'which ollama';
    
    exec(checkCommand, (error, stdout, stderr) => {
      if (error || !stdout.trim()) {
        resolve({ installed: false });
        return;
      }

      // HTTP 요청 옵션
      const options = {
        hostname: 'localhost',
        port: 11434,
        path: '/api/version',
        method: 'GET',
        timeout: 3000
      };

      const checkRunning = () => {
        const req = http.request(options, (res) => {
          if (res.statusCode === 200) {
            resolve({ installed: true, running: true });
          } else {
            tryToStartOllama();
          }
        });

        req.on('error', () => {
          tryToStartOllama();
        });

        req.end();
      };

      const tryToStartOllama = () => {
        // Ollama 자동 실행 시도
        const serveCommand = os.platform() === 'win32' ? 
          'start /min cmd /c ollama serve' : 
          'nohup ollama serve > /dev/null 2>&1 &';
          
        exec(serveCommand, (error) => {
          if (error) {
            resolve({ installed: true, running: false, autoStartFailed: true });
          } else {
            // 실행 후 잠시 대기하고 다시 확인
            setTimeout(() => {
              const recheckReq = http.request(options, (res) => {
                if (res.statusCode === 200) {
                  resolve({ installed: true, running: true });
                } else {
                  resolve({ installed: true, running: false, autoStartFailed: true });
                }
              });

              recheckReq.on('error', () => {
                resolve({ installed: true, running: false, autoStartFailed: true });
              });

              recheckReq.end();
            }, 3000);
          }
        });
      };

      checkRunning();
    });
  });
}

// IPC 핸들러 추가
ipcMain.handle('check-ollama-status', async () => {
  return await checkAndStartOllama();
});

// Ollama를 수동으로 실행하는 핸들러
ipcMain.handle('start-ollama-manually', async () => {
  const terminal = os.platform() === 'win32' ? 'start cmd /k' : 'open -a Terminal';
  exec(`${terminal} ollama serve`);
  return { success: true };
});