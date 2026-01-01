let handler = async (m, { conn, text, isGroup, groupMetadata }) => {
    const from = m.key.remoteJid;
    const args = text.trim().split(/\s+/).filter(Boolean);

    if (!isGroup) {
        return await conn.sendMessage(from, {
            text: '「✦」Este comando solo funciona en *grupos*.'
        }, { quoted: m });
    }

    if (!args[0]) {
        return await conn.sendMessage(from, {
            text: '「✦」Uso correcto:\n> ✐ *.gp abrir*\n> ✐ *.gp cerrar*'
        }, { quoted: m });
    }

    const opt = args[0].toLowerCase();
    const isClosed = Boolean(groupMetadata?.announce);

    if (opt === 'abrir') {
        if (!isClosed) {
            return await conn.sendMessage(from, {
                text: '「✦」Este grupo ya se encuentra *abierto*.\n> ✐ Estado » *todos pueden escribir*'
            }, { quoted: m });
        }
        await conn.groupSettingUpdate(from, 'not_announcement');
        return await conn.sendMessage(from, {
            text: '「✦」Grupo abierto correctamente.\n> ✐ Estado » *todos pueden escribir*'
        }, { quoted: m });
    }

    if (opt === 'cerrar') {
        if (isClosed) {
            return await conn.sendMessage(from, {
                text: '「✦」Este grupo ya se encuentra *cerrado*.\n> ✐ Estado » *solo admins*'
            }, { quoted: m });
        }
        await conn.groupSettingUpdate(from, 'announcement');
        return await conn.sendMessage(from, {
            text: '「✦」Grupo cerrado correctamente.\n> ✐ Estado » *solo admins*'
        }, { quoted: m });
    }

    return await conn.sendMessage(from, {
        text: '「✦」Opción inválida.\n> ✐ Usa » *.gp abrir* | *.gp cerrar*'
    }, { quoted: m });
};

handler.help = ['gp <abrir|cerrar>'];
handler.tags = ['group'];
handler.command = ['gp', 'group'];
handler.useradm = true;
handler.botadm = true;

export default handler;
