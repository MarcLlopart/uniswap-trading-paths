import React, { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, Layers, Sun, Moon, AlertTriangle } from 'lucide-react';
import './Dashboard.css';

const formatCurrency = (value) => {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(1)}`;
};

const formatFullCurrency = (value) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};
const formatFeeSmart = (feeStr) => {
    if (!feeStr) return '';
    // Remove the % and convert to number
    const numericValue = parseFloat(feeStr.replace('%', ''));
    // Convert to string, remove trailing zeros but keep at least one decimal
    let formatted = numericValue.toString();

    // Ensure at least one decimal place
    if (!formatted.includes('.')) {
        formatted += '.0';
    } else {
        // Remove trailing zeros after decimal
        formatted = formatted.replace(/(\.\d*?[1-9])0+$/, '$1');
        // If it ends with ".", add 0
        if (formatted.endsWith('.')) formatted += '0';
    }

    return `${formatted}%`;
};

const Dashboard = () => {
    const [rawData, setRawData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedChain, setSelectedChain] = useState('ALL');
    const [activeTab, setActiveTab] = useState('Volume');
    const [isDarkMode, setIsDarkMode] = useState(true);

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.remove('light-mode');
        } else {
            document.documentElement.classList.add('light-mode');
        }
    }, [isDarkMode]);

    useEffect(() => {
        fetch('/uniswap_data.json')
            .then(res => res.json())
            .then(data => {
                setRawData(data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to load data", err);
                setLoading(false);
            });
    }, []);

    const processedData = useMemo(() => {
        if (!rawData || !rawData.chains) return null;

        const chainsToAggregate = selectedChain === 'ALL'
            ? Object.keys(rawData.chains)
            : [selectedChain];

        // Aggregate monthly data
        const monthlyAgg = {};

        chainsToAggregate.forEach(chainKey => {
            const history = rawData.chains[chainKey];
            history.forEach(item => {
                if (!monthlyAgg[item.date]) {
                    monthlyAgg[item.date] = { date: item.date, volume: 0, fees: 0 };
                }
                monthlyAgg[item.date].volume += item.volume;
                monthlyAgg[item.date].fees += item.fees;
            });
        });

        const history = Object.values(monthlyAgg).sort((a, b) => a.date.localeCompare(b.date));

        // Calculate Deltas (current week vs previous week)
        const currentWeek = history[history.length - 1];
        const previousWeek = history[history.length - 2];

        let volumeDelta = 0;
        let feesDelta = 0;

        if (currentWeek && previousWeek && previousWeek.volume > 0) {
            volumeDelta = ((currentWeek.volume - previousWeek.volume) / previousWeek.volume) * 100;
        }
        if (currentWeek && previousWeek && previousWeek.fees > 0) {
            feesDelta = ((currentWeek.fees - previousWeek.fees) / previousWeek.fees) * 100;
        }

        return {
            currentVolume: currentWeek ? currentWeek.volume : 0,
            currentFees: currentWeek ? currentWeek.fees : 0,
            volumeDelta,
            feesDelta,
            history
        };
    }, [rawData, selectedChain]);

    if (loading) return <div className="loading">Loading Uniswap V4 Data...</div>;
    if (!rawData) return <div className="error">Failed to load data. Please run the fetcher script.</div>;

    const { currentVolume, currentFees, volumeDelta, feesDelta, history } = processedData || {};

    // Chart Data Preparation - Show last 8 weeks
    const chartData = history ? history.slice(-8).map(item => {
        const date = new Date(item.date);
        return {
            name: `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            volume: item.volume,
            fees: item.fees,
            originalDate: item.date
        };
    }) : [];

    const availableChains = ['ALL', ...Object.keys(rawData.chains)];

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div className="header-top">
                    <div className="logo-area">
                        <div className="uniswap-badge">
                            <img
                                style={{ width: '32px', height: '32px' }}
                                src={isDarkMode ? "/uniswap_black.webp" : "/uniswap.png"}
                                alt="Uniswap V4"
                            />
                        </div>
                        <h1 className="h1-gradient">Uniswap V4 Analytics</h1>
                    </div>
                    <button className="theme-toggle" onClick={() => setIsDarkMode(!isDarkMode)}>
                        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </div>

                <div className="chain-selector">
                    {availableChains.map(chain => (
                        <button
                            key={chain}
                            className={`chain-btn ${selectedChain === chain ? 'active' : ''}`}
                            onClick={() => setSelectedChain(chain)}
                        >
                            {chain}
                        </button>
                    ))}
                </div>

                {/* Pool Info Display */}
                {selectedChain !== 'ALL' && rawData.poolMetadata && rawData.poolMetadata[selectedChain] && (
                    <div className="pool-info">
                        <span className="pool-label">Pool:</span>
                        <span className="pool-pair">{rawData.poolMetadata[selectedChain].pair}</span>
                        <span className="pool-fee">
                            Fee: {formatFeeSmart(rawData.poolMetadata[selectedChain].feePercent)}
                        </span>
                    </div>
                )}
                {selectedChain === 'ALL' && (
                    <div className="pool-info">
                        <span className="pool-label">Viewing:</span>
                        <span className="pool-pair">All Chains Aggregated</span>
                    </div>
                )}
            </header>

            <div className="kpi-grid">
                <Card
                    title="Weekly Volume"
                    value={currentVolume}
                    delta={volumeDelta}
                    icon={<Activity size={24} />}
                    isActive={activeTab === 'Volume'}
                    onClick={() => setActiveTab('Volume')}
                />
                <Card
                    title="Weekly Fees"
                    value={currentFees}
                    delta={feesDelta}
                    icon={<DollarSign size={24} />}
                    isActive={activeTab === 'Fees'}
                    onClick={() => setActiveTab('Fees')}
                />
            </div>

            <div className="chart-section glass-card">
                <div className="chart-header">
                    <div className="chart-tabs">
                        <button
                            className={`chart-tab ${activeTab === 'Volume' ? 'active' : ''}`}
                            onClick={() => setActiveTab('Volume')}
                        >
                            Volume
                        </button>
                        <button
                            className={`chart-tab ${activeTab === 'Fees' ? 'active' : ''}`}
                            onClick={() => setActiveTab('Fees')}
                        >
                            Fees
                        </button>
                    </div>

                    <div className="chart-legend">
                        <span className={`dot ${activeTab === 'Volume' ? 'volume-dot' : 'fees-dot'}`}></span>
                        {selectedChain} {activeTab}
                    </div>
                </div>

                <div className="chart-wrapper">
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: isDarkMode ? "#17cac6" : "#830057", fontSize: 12 }}
                                dy={10}
                                label={{
                                    value: 'Date',
                                    position: 'insideBottom',
                                    offset: -15,
                                    style: {
                                        fill: 'var(--text-primary)',
                                        textAnchor: 'middle'
                                    }
                                }}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => formatCurrency(val)}
                                tick={{ fill: isDarkMode ? "#17cac6" : "#830057", fontSize: 12 }}
                                label={{
                                    value: activeTab === 'Volume' ? "Volume ($)" : "Fees ($)",
                                    position: 'insideLeft',
                                    angle: -90,
                                    offset: -15,
                                    style: { fill: 'var(--text-primary)', textAnchor: 'middle' }
                                }}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                                contentStyle={{
                                    backgroundColor: '#161821',
                                    borderColor: 'rgba(255,255,255,0.1)',
                                    borderRadius: '8px'
                                }}
                                itemStyle={{ color: '#fff' }}
                                formatter={(value) => [formatFullCurrency(value), activeTab]}
                            />
                            <Bar
                                dataKey={activeTab === 'Volume' ? 'volume' : 'fees'}
                                name={activeTab === 'Volume' ? 'Volume' : 'Fees'}
                                radius={[4, 4, 0, 0]}
                                barSize={30}
                                animationDuration={1000}
                                fill={'var(--accent-primary)'}
                            />
                            <Legend
                                wrapperStyle={{
                                    paddingTop: '20px'
                                }}
                                iconType="line"
                                formatter={(value) => (
                                    <span style={{ color: 'var(--text-primary)' }}>{value}</span>
                                )}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <p className="disclaimer">
                <AlertTriangle size={14} style={{ marginRight: '6px', verticalAlign: 'middle', display: 'inline-block' }} />
                Data provided by The Graph subgraphs. Accuracy depends on subgraph indexing status.
            </p>
        </div>
    );
};

const Card = ({ title, value, delta, icon, isActive, onClick }) => {
    const isPositive = delta >= 0;
    return (
        <div
            className={`kpi-card glass-card ${isActive ? 'active-card' : ''}`}
            onClick={onClick}
            style={{ cursor: 'pointer' }}
        >
            <div className="card-icon-wrapper">
                {icon}
            </div>
            <div className="card-content">
                <h3>{title}</h3>
                <div className="card-value">{formatCurrency(value)}</div>
                <div className={`card-delta ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                    <span>{Math.abs(delta).toFixed(2)}%</span>
                    <span>vs last week</span>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
