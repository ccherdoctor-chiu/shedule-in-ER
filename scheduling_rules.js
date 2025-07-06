/**
 * @file scheduling_rules.js
 * @description 排班規則檢查引擎 (增強版)。
 * 這個檔案將所有排班條件的驗證邏輯封裝起來，與主介面的程式碼分離。
 * 採用模組化設計，方便未來擴充新的排班規則。
 * 
 * 新增功能：
 * - 員工可用性檢查
 * - 更完善的衝突檢測
 * - 模組化的規則處理架構
 */

(function(window) {
    'use strict';

    // 定義規則引擎物件
    const RuleEngine = {};

    // --- 私有輔助函式 ---

    /**
     * 清除所有驗證高亮顯示
     * @param {HTMLElement} calendarGrid - 日曆網格元素
     */
    function clearValidationHighlights(calendarGrid) {
        calendarGrid.querySelectorAll('.conflict-cell').forEach(cell => {
            cell.classList.remove('conflict-cell');
        });
        calendarGrid.querySelectorAll('.conflict-indicator').forEach(indicator => {
            indicator.remove();
        });
    }

    /**
     * 高亮顯示衝突日期
     * @param {HTMLElement} calendarGrid - 日曆網格元素
     * @param {string} date - 日期字串 (YYYY-MM-DD)
     * @param {string} reason - 衝突原因
     */
    function highlightConflict(calendarGrid, date, reason) {
        const cell = calendarGrid.querySelector(`[data-date="${date}"]`);
        if (!cell) return;
        
        cell.classList.add('conflict-cell');
        
        let indicator = cell.querySelector('.conflict-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'conflict-indicator';
            indicator.innerHTML = '!<div class="conflict-tooltip"></div>';
            cell.appendChild(indicator);
        }
        
        const tooltip = indicator.querySelector('.conflict-tooltip');
        if (!tooltip.innerHTML.includes(reason)) {
            tooltip.innerHTML += `• ${reason}<br>`;
        }
    }

    /**
     * 格式化日期為字串
     * @param {Date} date - 日期物件
     * @returns {string} - 格式化的日期字串 (YYYY-MM-DD)
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // --- 規則處理函式定義 ---

    /**
     * 檢查最大連續工作天數
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkMaxConsecutiveWorkDays(context) {
        const { rule, scheduleData, year, month, calendarGrid } = context;
        const employee = rule.employee;
        const maxDays = parseInt(rule.value);
        let consecutiveCount = 0;
        let conflictCount = 0;

        // 檢查範圍擴展到前幾天，以確保跨月的連續工作天數也被檢查
        const startDate = new Date(year, month, 1 - maxDays);
        const endDate = new Date(year, month + 1, 0);

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            const isWorking = (scheduleData[dateStr] || []).some(s => 
                s.employee === employee && s.shift !== 'off'
            );

            if (isWorking) {
                consecutiveCount++;
                if (consecutiveCount > maxDays) {
                    const reason = `${employee} 連續工作第 ${consecutiveCount} 天 (超過限制 ${maxDays} 天)`;
                    // 只高亮顯示當前月份的日期
                    if (d.getFullYear() === year && d.getMonth() === month) {
                        conflictCount++;
                        highlightConflict(calendarGrid, dateStr, reason);
                    }
                }
            } else {
                consecutiveCount = 0;
            }
        }
        return conflictCount;
    }

    /**
     * 檢查是否為連續24小時班次 (夜班後接白班)
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkNo24HourShift(context) {
        const { rule, scheduleData, year, month, calendarGrid } = context;
        const employee = rule.employee;
        let conflictCount = 0;
        
        // 檢查當月每一天
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(year, month, day);
            const prevDate = new Date(year, month, day - 1);

            const currentDateStr = formatDate(currentDate);
            const prevDateStr = formatDate(prevDate);

            const todayShifts = scheduleData[currentDateStr] || [];
            const prevDayShifts = scheduleData[prevDateStr] || [];

            // 檢查前一天是否有夜班
            const hadNightShift = prevDayShifts.some(s => 
                s.employee === employee && s.shift === 'night'
            );
            
            // 檢查今天是否有白班
            const hasDayShift = todayShifts.some(s => 
                s.employee === employee && s.shift === 'day'
            );

            // 如果前一天夜班，今天白班，就是24小時連續工作
            if (hadNightShift && hasDayShift) {
                conflictCount++;
                const reason = `${employee} 夜班後隔天排白班 (${prevDateStr} 夜班 → ${currentDateStr} 白班)`;
                highlightConflict(calendarGrid, currentDateStr, reason);
                
                // 也在前一天標記衝突
                highlightConflict(calendarGrid, prevDateStr, `${employee} 夜班後隔天接白班`);
                
                // 除錯資訊
                console.warn(`檢測到24小時連續工作: ${employee}`, {
                    prevDate: prevDateStr,
                    currentDate: currentDateStr,
                    prevShifts: prevDayShifts,
                    todayShifts: todayShifts
                });
            }
        }
        
        // 額外檢查：跨月份的情況
        if (month > 0 || year > new Date().getFullYear() - 1) {
            // 檢查本月第一天是否接續上月最後一天的夜班
            const firstDay = new Date(year, month, 1);
            const lastDayPrevMonth = new Date(year, month, 0); // 上個月最後一天
            
            const firstDayStr = formatDate(firstDay);
            const lastDayPrevMonthStr = formatDate(lastDayPrevMonth);
            
            const firstDayShifts = scheduleData[firstDayStr] || [];
            const lastDayPrevMonthShifts = scheduleData[lastDayPrevMonthStr] || [];
            
            const hadNightShiftPrevMonth = lastDayPrevMonthShifts.some(s => 
                s.employee === employee && s.shift === 'night'
            );
            
            const hasDayShiftFirstDay = firstDayShifts.some(s => 
                s.employee === employee && s.shift === 'day'
            );
            
            if (hadNightShiftPrevMonth && hasDayShiftFirstDay) {
                conflictCount++;
                const reason = `${employee} 跨月24小時工作 (${lastDayPrevMonthStr} 夜班 → ${firstDayStr} 白班)`;
                highlightConflict(calendarGrid, firstDayStr, reason);
            }
        }
        
        return conflictCount;
    }

    /**
     * 檢查每日最少排班人數
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkMinStaff(context) {
        const { rule, scheduleData, year, month, shiftTypes, calendarGrid } = context;
        let conflictCount = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const staffCount = (scheduleData[dateStr] || []).filter(s => 
                s.shift === rule.shift
            ).length;
            
            if (staffCount < rule.value) {
                conflictCount++;
                const reason = `${shiftTypes[rule.shift]} 人數不足 (目前: ${staffCount}, 需要: ${rule.value})`;
                highlightConflict(calendarGrid, dateStr, reason);
            }
        }
        return conflictCount;
    }

    /**
     * 檢查員工白班夜班平衡 (新增規則)
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkShiftBalance(context) {
        const { rule, scheduleData, year, month, calendarGrid } = context;
        const employee = rule.employee;
        const maxDifference = parseInt(rule.value) || 2; // 預設允許最大差距2
        let conflictCount = 0;

        // 計算該員工在當月的白班和夜班數量
        let dayShiftCount = 0;
        let nightShiftCount = 0;
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const shifts = scheduleData[dateStr] || [];
            
            shifts.forEach(shift => {
                if (shift.employee === employee) {
                    if (shift.shift === 'day') dayShiftCount++;
                    if (shift.shift === 'night') nightShiftCount++;
                }
            });
        }

        // 檢查差距是否超過限制
        const difference = Math.abs(dayShiftCount - nightShiftCount);
        if (difference > maxDifference && (dayShiftCount > 0 || nightShiftCount > 0)) {
            conflictCount++;
            
            // 找出最後一個班次較多的日期來標記
            let lastShiftDate = null;
            const dominantShift = dayShiftCount > nightShiftCount ? 'day' : 'night';
            
            for (let day = daysInMonth; day >= 1; day--) {
                const dateStr = formatDate(new Date(year, month, day));
                const shifts = scheduleData[dateStr] || [];
                const hasTargetShift = shifts.some(s => 
                    s.employee === employee && s.shift === dominantShift
                );
                if (hasTargetShift) {
                    lastShiftDate = dateStr;
                    break;
                }
            }

            if (lastShiftDate) {
                const reason = `${employee} 班次不平衡：白班${dayShiftCount}次，夜班${nightShiftCount}次 (差距${difference}，限制${maxDifference})`;
                highlightConflict(calendarGrid, lastShiftDate, reason);
            }
        }

        return conflictCount;
    }

    /**
     * 檢查員工可用性衝突 (新增功能)
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkEmployeeAvailability(context) {
        const { scheduleData, employeeAvailability, year, month, calendarGrid } = context;
        let conflictCount = 0;
        
        if (!employeeAvailability) return 0;
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const shifts = scheduleData[dateStr] || [];

            shifts.forEach(shift => {
                // 只檢查工作班次，跳過休假
                if (shift.shift !== 'off') {
                    const employeeAvail = employeeAvailability[shift.employee];
                    
                    if (employeeAvail && employeeAvail[dateStr] === false) {
                        conflictCount++;
                        const reason = `${shift.employee} 在此日設定為不可用`;
                        highlightConflict(calendarGrid, dateStr, reason);
                    }
                }
            });
        }
        return conflictCount;
    }

    /**
     * 檢查員工重複排班 (新增功能)
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkDuplicateAssignment(context) {
        const { scheduleData, year, month, calendarGrid } = context;
        let conflictCount = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const shifts = scheduleData[dateStr] || [];
            
            // 檢查同一天是否有員工被安排多個工作班次
            const employeeShifts = {};
            shifts.forEach(shift => {
                if (shift.shift !== 'off') {
                    if (!employeeShifts[shift.employee]) {
                        employeeShifts[shift.employee] = [];
                    }
                    employeeShifts[shift.employee].push(shift.shift);
                }
            });

            Object.entries(employeeShifts).forEach(([employee, empShifts]) => {
                if (empShifts.length > 1) {
                    conflictCount++;
                    const reason = `${employee} 在同一天被安排多個班次: ${empShifts.join(', ')}`;
                    highlightConflict(calendarGrid, dateStr, reason);
                }
            });
        }
        return conflictCount;
    }

    /**
     * 系統自動檢查24小時連續工作（適用於所有員工）
     * @param {object} context - 包含規則與資料的上下文物件
     * @returns {number} - 發現的衝突數量
     */
    function checkSystemNo24HourShift(context) {
        const { scheduleData, year, month, calendarGrid } = context;
        let conflictCount = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        // 收集所有員工
        const allEmployees = new Set();
        Object.values(scheduleData).forEach(dayShifts => {
            dayShifts.forEach(shift => {
                if (shift.employee) {
                    allEmployees.add(shift.employee);
                }
            });
        });
        
        // 檢查每位員工
        allEmployees.forEach(employee => {
            for (let day = 1; day <= daysInMonth; day++) {
                const currentDate = new Date(year, month, day);
                const prevDate = new Date(year, month, day - 1);

                const currentDateStr = formatDate(currentDate);
                const prevDateStr = formatDate(prevDate);

                const todayShifts = scheduleData[currentDateStr] || [];
                const prevDayShifts = scheduleData[prevDateStr] || [];

                // 檢查前一天是否有夜班
                const hadNightShift = prevDayShifts.some(s => 
                    s.employee === employee && s.shift === 'night'
                );
                
                // 檢查今天是否有白班
                const hasDayShift = todayShifts.some(s => 
                    s.employee === employee && s.shift === 'day'
                );

                // 如果前一天夜班，今天白班，就是24小時連續工作
                if (hadNightShift && hasDayShift) {
                    conflictCount++;
                    const reason = `${employee} 24小時連續工作 (${prevDateStr} 夜班 → ${currentDateStr} 白班)`;
                    highlightConflict(calendarGrid, currentDateStr, reason);
                    
                    // 除錯資訊
                    console.log(`檢測到24小時連續工作: ${employee}`, {
                        prevDate: prevDateStr,
                        currentDate: currentDateStr,
                        prevShifts: prevDayShifts.filter(s => s.employee === employee),
                        todayShifts: todayShifts.filter(s => s.employee === employee)
                    });
                }
            }
            
            // 跨月檢查
            if (month > 0 || year > new Date().getFullYear() - 1) {
                const firstDay = new Date(year, month, 1);
                const lastDayPrevMonth = new Date(year, month, 0);
                
                const firstDayStr = formatDate(firstDay);
                const lastDayPrevMonthStr = formatDate(lastDayPrevMonth);
                
                const firstDayShifts = scheduleData[firstDayStr] || [];
                const lastDayPrevMonthShifts = scheduleData[lastDayPrevMonthStr] || [];
                
                const hadNightShiftPrevMonth = lastDayPrevMonthShifts.some(s => 
                    s.employee === employee && s.shift === 'night'
                );
                
                const hasDayShiftFirstDay = firstDayShifts.some(s => 
                    s.employee === employee && s.shift === 'day'
                );
                
                if (hadNightShiftPrevMonth && hasDayShiftFirstDay) {
                    conflictCount++;
                    const reason = `${employee} 跨月24小時工作 (${lastDayPrevMonthStr} 夜班 → ${firstDayStr} 白班)`;
                    highlightConflict(calendarGrid, firstDayStr, reason);
                }
            }
        });
        
        return conflictCount;
    }

    // --- 規則註冊表 ---
    const employeeRuleHandlers = {
        'maxConsecutiveWorkDays': checkMaxConsecutiveWorkDays,
        'no24HourShift': checkNo24HourShift,
        'balanceShifts': checkShiftBalance, // 新增：白班夜班平衡檢查
    };

    const shiftRuleHandlers = {
        'minStaff': checkMinStaff,
    };

    const systemRuleHandlers = {
        'employeeAvailability': checkEmployeeAvailability,
        'duplicateAssignment': checkDuplicateAssignment,
        'systemNo24HourShift': checkSystemNo24HourShift, // 新增：系統自動檢查24小時連續工作
    };

    // --- 公開的主要驗證函式 ---
    /**
     * 驗證排班表是否符合所有規則
     * @param {object} params - 驗證參數
     * @param {Date} params.currentDate - 當前檢查的月份
     * @param {object} params.scheduleData - 排班資料
     * @param {object} params.schedulingConditions - 排班條件設定
     * @param {object} params.shiftTypes - 班別類型定義
     * @param {HTMLElement} params.calendarGrid - 日曆網格元素
     * @param {object} params.employeeAvailability - 員工可用性資料
     */
    RuleEngine.validate = function(params) {
        const { 
            currentDate, 
            scheduleData, 
            schedulingConditions, 
            shiftTypes, 
            calendarGrid, 
            employeeAvailability 
        } = params;

        console.log('開始規則驗證...', {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth(),
            scheduleDataKeys: Object.keys(scheduleData).length,
            employeeRulesCount: schedulingConditions.employeeRules?.length || 0,
            shiftRulesCount: schedulingConditions.shiftRules?.length || 0
        });

        // 清除之前的高亮顯示
        clearValidationHighlights(calendarGrid);
        
        let totalConflicts = 0;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        // 建立檢查上下文
        const context = { 
            scheduleData, 
            year, 
            month, 
            shiftTypes, 
            calendarGrid, 
            employeeAvailability 
        };

        // 檢查員工規則
        if (schedulingConditions.employeeRules) {
            console.log('檢查員工規則...');
            schedulingConditions.employeeRules.forEach(rule => {
                console.log(`檢查員工規則: ${rule.employee} - ${rule.type}`);
                if (employeeRuleHandlers[rule.type]) {
                    const conflicts = employeeRuleHandlers[rule.type]({ ...context, rule });
                    totalConflicts += conflicts;
                    console.log(`員工規則 ${rule.type} 發現 ${conflicts} 個衝突`);
                }
            });
        }

        // 檢查班別規則
        if (schedulingConditions.shiftRules) {
            console.log('檢查班別規則...');
            schedulingConditions.shiftRules.forEach(rule => {
                if (shiftRuleHandlers[rule.type]) {
                    const conflicts = shiftRuleHandlers[rule.type]({ ...context, rule });
                    totalConflicts += conflicts;
                    console.log(`班別規則 ${rule.type} 發現 ${conflicts} 個衝突`);
                }
            });
        }

        // 檢查系統規則（員工可用性、重複排班等）
        console.log('檢查系統規則...');
        Object.entries(systemRuleHandlers).forEach(([ruleName, handler]) => {
            const conflicts = handler(context);
            totalConflicts += conflicts;
            console.log(`系統規則 ${ruleName} 發現 ${conflicts} 個衝突`);
        });
        
        console.log(`驗證完成，總共發現 ${totalConflicts} 個衝突`);
        
        // 顯示驗證結果
        if (totalConflicts === 0) {
            alert('🎉 太棒了！未發現任何排班衝突。');
        } else {
            alert(`⚠️ 發現 ${totalConflicts} 個排班衝突，請查看月曆上的紅色標記。\n\n詳細資訊請查看瀏覽器控制台。`);
        }

        return {
            totalConflicts,
            isValid: totalConflicts === 0
        };
    };

    // 暴露清除驗證高亮的方法
    RuleEngine.clearValidationHighlights = clearValidationHighlights;

    /**
     * 自動排班輔助函數：獲取最佳員工選擇
     * @param {Array} availableEmployees - 可用員工清單
     * @param {string} shiftType - 班別類型 ('day', 'night')
     * @param {number} requiredCount - 需要的人數
     * @param {object} employeeStats - 員工統計資料
     * @param {string} strategy - 排班策略
     * @param {string} date - 當前日期（用於輪班策略）
     * @returns {Array} - 建議的員工清單
     */
    RuleEngine.getBestEmployeeSelection = function(availableEmployees, shiftType, requiredCount, employeeStats, strategy = 'balanced', date = null) {
        if (availableEmployees.length <= requiredCount) {
            return availableEmployees;
        }

        let sortedEmployees = [...availableEmployees];

        switch (strategy) {
            case 'balanced':
                // 選擇總班次最少的員工，並考慮班次平衡
                sortedEmployees.sort((a, b) => {
                    const statA = employeeStats[a] || { totalShifts: 0, dayShifts: 0, nightShifts: 0 };
                    const statB = employeeStats[b] || { totalShifts: 0, dayShifts: 0, nightShifts: 0 };
                    
                    // 優先考慮總班次較少的員工
                    if (statA.totalShifts !== statB.totalShifts) {
                        return statA.totalShifts - statB.totalShifts;
                    }
                    
                    // 其次考慮班次平衡
                    if (shiftType === 'day') {
                        // 安排白班時，優先選擇夜班較多或白班較少的員工
                        const balanceA = statA.nightShifts - statA.dayShifts;
                        const balanceB = statB.nightShifts - statB.dayShifts;
                        return balanceB - balanceA;
                    } else if (shiftType === 'night') {
                        // 安排夜班時，優先選擇白班較多或夜班較少的員工
                        const balanceA = statA.dayShifts - statA.nightShifts;
                        const balanceB = statB.dayShifts - statB.nightShifts;
                        return balanceB - balanceA;
                    }
                    
                    // 最後按字母順序
                    return a.localeCompare(b);
                });
                break;

            case 'minimize_night':
                if (shiftType === 'night') {
                    // 夜班：選擇夜班次數最少的員工
                    sortedEmployees.sort((a, b) => {
                        const statA = employeeStats[a] || { nightShifts: 0, totalShifts: 0 };
                        const statB = employeeStats[b] || { nightShifts: 0, totalShifts: 0 };
                        
                        if (statA.nightShifts !== statB.nightShifts) {
                            return statA.nightShifts - statB.nightShifts;
                        }
                        return statA.totalShifts - statB.totalShifts;
                    });
                } else {
                    // 白班：選擇白班次數最少的員工
                    sortedEmployees.sort((a, b) => {
                        const statA = employeeStats[a] || { dayShifts: 0, totalShifts: 0 };
                        const statB = employeeStats[b] || { dayShifts: 0, totalShifts: 0 };
                        
                        if (statA.dayShifts !== statB.dayShifts) {
                            return statA.dayShifts - statB.dayShifts;
                        }
                        return statA.totalShifts - statB.totalShifts;
                    });
                }
                break;

            case 'rotate':
                // 輪班制：按字母順序，並根據日期偏移
                sortedEmployees.sort();
                if (date) {
                    const dayIndex = new Date(date).getDate();
                    const rotationOffset = dayIndex % sortedEmployees.length;
                    
                    // 重新排列數組以實現輪班效果
                    const rotated = [
                        ...sortedEmployees.slice(rotationOffset),
                        ...sortedEmployees.slice(0, rotationOffset)
                    ];
                    sortedEmployees = rotated;
                }
                break;

            default:
                // 預設使用平衡策略
                sortedEmployees.sort((a, b) => {
                    const statA = employeeStats[a] || { totalShifts: 0 };
                    const statB = employeeStats[b] || { totalShifts: 0 };
                    return statA.totalShifts - statB.totalShifts;
                });
        }

        return sortedEmployees.slice(0, requiredCount);
    };

    /**
     * 檢查並確保所有員工都有公平的排班機會
     * @param {object} employeeStats - 員工統計資料
     * @param {Array} employees - 所有員工清單
     * @returns {Array} - 需要優先安排的員工清單
     */
    RuleEngine.getUnderScheduledEmployees = function(employeeStats, employees) {
        // 計算平均班次數
        const totalShifts = Object.values(employeeStats).reduce((sum, stat) => sum + stat.totalShifts, 0);
        const averageShifts = totalShifts / employees.length;
        
        // 找出班次數低於平均值的員工
        const underScheduled = employees.filter(emp => {
            const empStat = employeeStats[emp] || { totalShifts: 0 };
            return empStat.totalShifts < averageShifts;
        });
        
        // 按班次數升序排列
        underScheduled.sort((a, b) => {
            const statA = employeeStats[a] || { totalShifts: 0 };
            const statB = employeeStats[b] || { totalShifts: 0 };
            return statA.totalShifts - statB.totalShifts;
        });
        
        return underScheduled;
    };

    /**
     * 改進的員工選擇策略，確保公平分配
     * @param {Array} availableEmployees - 可用員工清單
     * @param {string} shiftType - 班別類型
     * @param {number} requiredCount - 需要的人數
     * @param {object} employeeStats - 員工統計資料
     * @param {Array} allEmployees - 所有員工清單
     * @param {string} strategy - 排班策略
     * @param {string} date - 當前日期
     * @returns {Array} - 選中的員工清單
     */
    RuleEngine.selectEmployeesWithFairness = function(availableEmployees, shiftType, requiredCount, employeeStats, allEmployees, strategy = 'balanced', date = null) {
        if (availableEmployees.length <= requiredCount) {
            return availableEmployees;
        }

        // 找出排班不足的員工
        const underScheduled = this.getUnderScheduledEmployees(employeeStats, allEmployees);
        
        // 優先從可用且排班不足的員工中選擇
        const availableUnderScheduled = availableEmployees.filter(emp => 
            underScheduled.includes(emp)
        );
        
        let selected = [];
        
        // 先選擇排班不足的員工
        if (availableUnderScheduled.length > 0) {
            const priorityCount = Math.min(availableUnderScheduled.length, requiredCount);
            const prioritySelection = this.getBestEmployeeSelection(
                availableUnderScheduled, 
                shiftType, 
                priorityCount, 
                employeeStats, 
                strategy, 
                date
            );
            selected.push(...prioritySelection);
        }
        
        // 如果還需要更多員工，從剩餘可用員工中選擇
        if (selected.length < requiredCount) {
            const remainingAvailable = availableEmployees.filter(emp => !selected.includes(emp));
            const remainingCount = requiredCount - selected.length;
            
            if (remainingAvailable.length > 0) {
                const remainingSelection = this.getBestEmployeeSelection(
                    remainingAvailable, 
                    shiftType, 
                    remainingCount, 
                    employeeStats, 
                    strategy, 
                    date
                );
                selected.push(...remainingSelection);
            }
        }
        
        return selected;
    };

    // 將 RuleEngine 暴露到全域
    window.RuleEngine = RuleEngine;

})(window);