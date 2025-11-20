// server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// File path for saving board data
const DATA_FILE = 'data.json';
const LOG_FILE = 'activity.log'; // Файл для логов

// Load board data from file or use default
let boardData = loadBoardData();

// Store connected users
let users = {};

// Global alert state
let currentAlert = null;

// Function to load board data from file
function loadBoardData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading board data:', error);
        logActivity('ERROR', 'system', `Ошибка загрузки данных: ${error.message}`);
    }

    // Return default data if file doesn't exist or error
    return {
        columns: [
            { id: 1, title: "Заказы", wipLimit: null, cards: [], collapsed: false },
            { id: 2, title: "Печать KBA", wipLimit: 3, cards: [], collapsed: false },
            { id: 3, title: "Печать Roland", wipLimit: 3, cards: [], collapsed: false },
            { id: 4, title: "Тиснение", wipLimit: 2, cards: [], collapsed: false },
            { id: 5, title: "УФ", wipLimit: 2, cards: [], collapsed: false },
            { id: 6, title: "Ламинация", wipLimit: 2, cards: [], collapsed: false },
            { id: 7, title: "Кашировка", wipLimit: 2, cards: [], collapsed: false },
            { id: 8, title: "Резка", wipLimit: 3, cards: [], collapsed: false },
            { id: 9, title: "Конгрев", wipLimit: 2, cards: [], collapsed: false },
            { id: 10, title: "Высечка", wipLimit: 2, cards: [], collapsed: false },
            { id: 11, title: "Вырубка БРАУЗ", wipLimit: 2, cards: [], collapsed: false },
            { id: 12, title: "Вырубка ЦЕНТУРИОН", wipLimit: 2, cards: [], collapsed: false },
            { id: 13, title: "Выборка", wipLimit: 2, cards: [], collapsed: false },
            { id: 14, title: "Пленка", wipLimit: 2, cards: [], collapsed: false },
            { id: 15, title: "Окошки", wipLimit: 2, cards: [], collapsed: false },
            { id: 16, title: "Склейка", wipLimit: 3, cards: [], collapsed: false },
            { id: 17, title: "Сверловка", wipLimit: 2, cards: [], collapsed: false },
            { id: 18, title: "Брошюровка", wipLimit: 2, cards: [], collapsed: false },
            { id: 19, title: "Подрезка", wipLimit: 3, cards: [], collapsed: false },
            { id: 20, title: "Упаковка", wipLimit: 4, cards: [], collapsed: false },
            { id: 21, title: "Склад", wipLimit: null, cards: [], collapsed: false }
        ]
    };
}

// Function to save board data to file
function saveBoardData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(boardData, null, 2));
        console.log('Board data saved successfully');
    } catch (error) {
        console.error('Error saving board data:', error);
        logActivity('ERROR', 'system', `Ошибка сохранения данных: ${error.message}`);
    }
}

// Функция для логирования активности
function logActivity(action, userName, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${action} | Пользователь: ${userName} | ${details}\n`;

    try {
        fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
        console.log(logEntry.trim()); // Также выводим в консоль
    } catch (error) {
        console.error('Ошибка записи в лог:', error);
    }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('Новое подключение');

    // Отправляем текущее состояние оповещения новому клиенту
    if (currentAlert) {
        ws.send(JSON.stringify({
            type: 'alert_created',
            alertText: currentAlert
        }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
            logActivity('ERROR', 'unknown', `Ошибка обработки сообщения: ${error.message}`);
        }
    });

    ws.on('close', () => {
        // Find and remove the disconnected user
        for (const userId in users) {
            if (users[userId].ws === ws) {
                console.log(`Пользователь ${users[userId].name} отключился`);
                logActivity('DISCONNECT', users[userId].name, 'Пользователь отключился');
                broadcast({
                    type: 'user_left',
                    userId: userId
                });
                delete users[userId];
                break;
            }
        }
    });
});

// Handle incoming messages
function handleMessage(ws, data) {
    let userName = 'unknown';

    // Получаем имя пользователя для логирования
    if (data.userId && users[data.userId]) {
        userName = users[data.userId].name;
    } else if (data.user && data.user.name) {
        userName = data.user.name;
    }

    switch (data.type) {
        case 'user_joined':
            users[data.user.id] = {
                ...data.user,
                ws: ws
            };
            // Send current board state to the new user
            ws.send(JSON.stringify({
                type: 'board_data',
                data: boardData
            }));
            // Notify all users about the new user
            broadcast({
                type: 'user_joined',
                user: data.user
            });
            // Send updated users list to everyone
            broadcastUsersList();

            logActivity('CONNECT', data.user.name, 'Пользователь подключился');
            break;

        case 'get_board':
            ws.send(JSON.stringify({
                type: 'board_data',
                data: boardData
            }));
            break;

        case 'card_moved':
            // Update board data
            const fromColumn = boardData.columns.find(col => col.id === data.fromColumnId);
            const toColumn = boardData.columns.find(col => col.id === data.toColumnId);
            const card = fromColumn ? fromColumn.cards.find(c => c.id === data.cardId) : null;

            applyCardMove(data.cardId, data.fromColumnId, data.toColumnId);
            // Save to file
            saveBoardData();
            // Broadcast the move to all other users
            broadcast({
                type: 'card_moved',
                userId: data.userId,
                cardId: data.cardId,
                fromColumnId: data.fromColumnId,
                toColumnId: data.toColumnId
            });

            if (card && fromColumn && toColumn) {
                logActivity('MOVE', userName,
                    `Переместил карточку "${card.title}" из "${fromColumn.title}" в "${toColumn.title}"`);
            }
            break;

        case 'card_created':
            // Add card to board data
            const column = boardData.columns.find(col => col.id === data.columnId);
            if (column) {
                column.cards.push(data.card);
                // Save to file
                saveBoardData();
                // Broadcast the new card to all other users
                broadcast({
                    type: 'card_created',
                    userId: data.userId,
                    columnId: data.columnId,
                    card: data.card
                });

                logActivity('CREATE', userName,
                    `Создал карточку "${data.card.title}" в колонке "${column.title}"`);
            }
            break;

        case 'card_updated':
            // Update card in board data
            const updateColumn = boardData.columns.find(col => col.id === data.columnId);
            if (updateColumn) {
                const cardIndex = updateColumn.cards.findIndex(card => card.id === data.card.id);
                if (cardIndex !== -1) {
                    const oldCard = updateColumn.cards[cardIndex];
                    updateColumn.cards[cardIndex] = data.card;
                    // Save to file
                    saveBoardData();
                    // Broadcast the update to all other users
                    broadcast({
                        type: 'card_updated',
                        userId: data.userId,
                        columnId: data.columnId,
                        card: data.card
                    });

                    logActivity('UPDATE', userName,
                        `Обновил карточку "${data.card.title}" в колонке "${updateColumn.title}"`);
                }
            }
            break;

        case 'card_deleted':
            // Remove card from board data
            const col = boardData.columns.find(c => c.id === data.columnId);
            if (col) {
                const cardToDelete = col.cards.find(c => c.id === data.cardId);
                col.cards = col.cards.filter(card => card.id !== data.cardId);
                // Save to file
                saveBoardData();
                // Broadcast the deletion to all other users
                broadcast({
                    type: 'card_deleted',
                    userId: data.userId,
                    cardId: data.cardId,
                    columnId: data.columnId
                });

                if (cardToDelete) {
                    logActivity('DELETE', userName,
                        `Удалил карточку "${cardToDelete.title}" из колонке "${col.title}"`);
                }
            }
            break;

        case 'card_reordered':
            // Update card order in column
            const reorderColumn = boardData.columns.find(col => col.id === data.columnId);
            if (reorderColumn) {
                reorderColumn.cards = data.cards;
                // Save to file
                saveBoardData();
                // Broadcast the reorder to all other users
                broadcast({
                    type: 'card_reordered',
                    userId: data.userId,
                    columnId: data.columnId,
                    cards: data.cards
                });

                logActivity('REORDER', userName,
                    `Изменил порядок карточек в колонке "${reorderColumn.title}"`);
            }
            break;

        case 'alert_created':
            // Set global alert state
            currentAlert = data.alertText;
            // Broadcast alert to all users
            broadcast({
                type: 'alert_created',
                alertText: data.alertText
            });

            logActivity('ALERT', userName, `Создал оповещение: "${data.alertText}"`);
            break;

        case 'alert_cleared':
            // Clear global alert state
            currentAlert = null;
            // Broadcast alert clear to all users
            broadcast({
                type: 'alert_cleared'
            });

            logActivity('ALERT_CLEAR', userName, 'Очистил оповещение');
            break;

        case 'reset_board':
            // Reset board to default state
            boardData = {
                columns: [
                    { id: 1, title: "Заказы", wipLimit: null, cards: [], collapsed: false },
                    { id: 2, title: "Печать KBA", wipLimit: 3, cards: [], collapsed: false },
                    { id: 3, title: "Печать Roland", wipLimit: 3, cards: [], collapsed: false },
                    { id: 4, title: "Тиснение", wipLimit: 2, cards: [], collapsed: false },
                    { id: 5, title: "УФ", wipLimit: 2, cards: [], collapsed: false },
                    { id: 6, title: "Ламинация", wipLimit: 2, cards: [], collapsed: false },
                    { id: 7, title: "Кашировка", wipLimit: 2, cards: [], collapsed: false },
                    { id: 8, title: "Резка", wipLimit: 3, cards: [], collapsed: false },
                    { id: 9, title: "Конгрев", wipLimit: 2, cards: [], collapsed: false },
                    { id: 10, title: "Высечка", wipLimit: 2, cards: [], collapsed: false },
                    { id: 11, title: "Вырубка БРАУЗ", wipLimit: 2, cards: [], collapsed: false },
                    { id: 12, title: "Вырубка ЦЕНТУРИОН", wipLimit: 2, cards: [], collapsed: false },
                    { id: 13, title: "Выборка", wipLimit: 2, cards: [], collapsed: false },
                    { id: 14, title: "Пленка", wipLimit: 2, cards: [], collapsed: false },
                    { id: 15, title: "Окошки", wipLimit: 2, cards: [], collapsed: false },
                    { id: 16, title: "Склейка", wipLimit: 3, cards: [], collapsed: false },
                    { id: 17, title: "Сверловка", wipLimit: 2, cards: [], collapsed: false },
                    { id: 18, title: "Брошюровка", wipLimit: 2, cards: [], collapsed: false },
                    { id: 19, title: "Подрезка", wipLimit: 3, cards: [], collapsed: false },
                    { id: 20, title: "Упаковка", wipLimit: 4, cards: [], collapsed: false },
                    { id: 21, title: "Склад", wipLimit: null, cards: [], collapsed: false }
                ]
            };
            // Save to file
            saveBoardData();
            // Broadcast reset to all users
            broadcast({
                type: 'board_data',
                data: boardData
            });

            logActivity('RESET', userName, 'Сбросил всю доску к начальному состоянию');
            break;
    }
}

// Apply card move to board data
function applyCardMove(cardId, fromColumnId, toColumnId) {
    // Find the card and source column
    let sourceColumn = null;
    let card = null;

    for (const column of boardData.columns) {
        const cardIndex = column.cards.findIndex(c => c.id === cardId);
        if (cardIndex !== -1) {
            sourceColumn = column;
            card = column.cards[cardIndex];
            break;
        }
    }

    // If card found and it's not already in the target column
    if (sourceColumn && card && sourceColumn.id !== toColumnId) {
        // Remove from source column
        sourceColumn.cards = sourceColumn.cards.filter(c => c.id !== cardId);

        // Add to target column
        const targetColumn = boardData.columns.find(col => col.id === toColumnId);
        if (targetColumn) {
            targetColumn.cards.push(card);
        }
    }
}

// Broadcast message to all connected clients
function broadcast(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Send updated users list to all clients
function broadcastUsersList() {
    const usersList = {};
    for (const userId in users) {
        usersList[userId] = {
            id: users[userId].id,
            name: users[userId].name,
            color: users[userId].color
        };
    }

    broadcast({
        type: 'users_list',
        users: usersList
    });
}

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Локальный доступ: http://localhost:${PORT}`);

    // Get network interfaces to display available IPs
    const os = require('os');
    const interfaces = os.networkInterfaces();

    console.log('Доступ с других устройств:');
    for (const interfaceName in interfaces) {
        for (const iface of interfaces[interfaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`  http://${iface.address}:${PORT}`);
            }
        }
    }

    console.log('Данные загружены из файла:', DATA_FILE);
    console.log('Логи будут записываться в файл:', LOG_FILE);

    logActivity('START', 'system', 'Сервер запущен');
});